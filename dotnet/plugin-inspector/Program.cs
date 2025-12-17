using System.ComponentModel;
using System.Reflection;
using System.Text.Json;

record PluginDescriptor(string TypeName, string Name, string? FriendlyName);

class Program
{
    internal static readonly bool DebugEnabled =
        string.Equals(Environment.GetEnvironmentVariable("PLUGIN_INSPECTOR_DEBUG"), "1", StringComparison.Ordinal);

    private static void Debug(string message)
    {
        if (DebugEnabled)
        {
            Console.Error.WriteLine(message);
        }
    }

    static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine("Assembly path is required.");
            return 1;
        }

        var assemblyPath = Path.GetFullPath(args[0]);
        if (!File.Exists(assemblyPath))
        {
            Console.Error.WriteLine($"Assembly not found: {assemblyPath}");
            return 1;
        }

        try
        {
            var plugins = DiscoverPlugins(assemblyPath);
            var payload = new { plugins };
            Console.Write(JsonSerializer.Serialize(payload, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                WriteIndented = false
            }));
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.ToString());
            return 1;
        }
    }

    private static IReadOnlyCollection<PluginDescriptor> DiscoverPlugins(string assemblyPath)
    {
        var runtimePaths = GetRuntimeAssemblies();
        var assemblyDir = Path.GetDirectoryName(assemblyPath) ?? Environment.CurrentDirectory;
        var assemblyPaths = Directory.EnumerateFiles(assemblyDir, "*.dll", SearchOption.TopDirectoryOnly);

        var additionalPaths = FindSdkAssemblies()
            .Concat(FindReferenceAssemblies());

        // Prefer assemblies that ship alongside the plugin (assemblyPaths) over host runtime paths.
        var resolver = new CompositeAssemblyResolver(
            assemblyPaths.Concat(additionalPaths).Concat(runtimePaths));

        // Use mscorlib as the core assembly for better compatibility with netfx-targeted plugins.
        using var context = new MetadataLoadContext(resolver, "mscorlib");
        Debug($"[inspector] loading assembly: {assemblyPath}");
        var assembly = context.LoadFromAssemblyPath(assemblyPath);
        var pluginInterface = ResolveIPlugin(context);
        Debug(pluginInterface != null
            ? $"[inspector] resolved IPlugin: {pluginInterface.Assembly.FullName}"
            : "[inspector] failed to resolve IPlugin");

        var results = new List<PluginDescriptor>();
        var loadableTypes = GetLoadableTypes(assembly).ToList();
        Debug($"[inspector] loadable types: {loadableTypes.Count}");

        foreach (var type in loadableTypes)
        {
            if (!type.IsClass || type.IsAbstract || type.IsGenericType)
            {
                continue;
            }

            if (!IsPluginType(type, pluginInterface))
            {
                continue;
            }

            var name = type.FullName ?? type.Name;
            var friendlyName = GetFriendlyName(type);
            results.Add(new PluginDescriptor(type.FullName ?? type.Name, name, friendlyName));
        }

        if (DebugEnabled)
        {
            Console.Error.WriteLine($"[inspector] discovered {results.Count} plugin types in {assemblyPath}");
            foreach (var item in results)
            {
                Console.Error.WriteLine($"[inspector] plugin: {item.TypeName} (name={item.Name}, friendly={item.FriendlyName})");
            }
        }

        return results;
    }

    private static IEnumerable<Type> GetLoadableTypes(Assembly assembly)
    {
        try
        {
            return assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            foreach (var loaderEx in ex.LoaderExceptions)
            {
                Debug($"[inspector] loader exception: {loaderEx}");
            }
            return ex.Types.Where(t => t != null)!;
        }
    }

    private static Type? ResolveIPlugin(MetadataLoadContext context)
    {
        try
        {
            var assembly = context.LoadFromAssemblyName(new AssemblyName("Microsoft.Xrm.Sdk"));
            return assembly.GetType("Microsoft.Xrm.Sdk.IPlugin");
        }
        catch (Exception ex)
        {
            Debug($"[inspector] failed to load Microsoft.Xrm.Sdk: {ex}");
            return null;
        }
    }

    private static bool IsPluginType(Type type, Type? pluginInterface)
    {
        if (pluginInterface != null)
        {
            try
            {
                if (pluginInterface.IsAssignableFrom(type))
                {
                    Debug($"[inspector] plugin detected by assignable: {type.FullName}");
                    return true;
                }
            }
            catch
            {
                // fall back to name-based check
            }
        }

        try
        {
            return type.GetInterfaces().Any(i => i.FullName == "Microsoft.Xrm.Sdk.IPlugin");
        }
        catch
        {
            return false;
        }
    }

    private static string? GetFriendlyName(Type type)
    {
        try
        {
            var displayName = type.GetCustomAttributes(true)
                .OfType<DisplayNameAttribute>()
                .FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(displayName?.DisplayName))
            {
                return displayName.DisplayName;
            }
        }
        catch
        {
            // ignore attribute errors
        }

        return type.Name;
    }

    private static IEnumerable<string> GetRuntimeAssemblies()
    {
        var tpa = (string?)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES");
        if (string.IsNullOrWhiteSpace(tpa))
        {
            return Array.Empty<string>();
        }

        return tpa.Split(Path.PathSeparator);
    }

    private static IEnumerable<string> FindSdkAssemblies()
    {
        // Look for common SDK references (e.g., Microsoft.Xrm.Sdk) in the plugin bin folder and NuGet cache.
        var candidates = new List<string>();
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var nugetPackages = Path.Combine(home, ".nuget", "packages");
        if (Directory.Exists(nugetPackages))
        {
          var sdkAssemblies = Directory.EnumerateFiles(nugetPackages, "Microsoft.Xrm.Sdk.dll", SearchOption.AllDirectories)
              .OrderByDescending(File.GetLastWriteTimeUtc);
          candidates.AddRange(sdkAssemblies);
        }

        return candidates;
    }

    private static IEnumerable<string> FindReferenceAssemblies()
    {
        // Add .NET Framework 4.6.2 reference assemblies to improve compatibility with net462 plugins.
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var refRoot = Path.Combine(home, ".nuget", "packages", "microsoft.netframework.referenceassemblies.net462");
        if (!Directory.Exists(refRoot))
        {
            return Array.Empty<string>();
        }

        var latest = Directory.EnumerateDirectories(refRoot)
            .OrderByDescending(Path.GetFileName)
            .FirstOrDefault();
        if (latest == null)
        {
            return Array.Empty<string>();
        }

        var refDir = Path.Combine(latest, "build", ".NETFramework", "v4.6.2");
        if (!Directory.Exists(refDir))
        {
            return Array.Empty<string>();
        }

        return Directory.EnumerateFiles(refDir, "*.dll", SearchOption.TopDirectoryOnly);
    }
}

class CompositeAssemblyResolver : MetadataAssemblyResolver
{
    private readonly Dictionary<string, string> _bySimpleName;

    public CompositeAssemblyResolver(IEnumerable<string> assemblyPaths)
    {
        var allPaths = assemblyPaths
            .Select(Path.GetFullPath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var mscorlibCandidates = allPaths
            .Where(p => string.Equals(Path.GetFileName(p), "mscorlib.dll", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var preferredMscorlib = mscorlibCandidates
            .FirstOrDefault(p => p.IndexOf("ReferenceAssemblies", StringComparison.OrdinalIgnoreCase) >= 0)
            ?? mscorlibCandidates.FirstOrDefault();

        var paths = allPaths
            .Where(p => !string.Equals(Path.GetFileName(p), "mscorlib.dll", StringComparison.OrdinalIgnoreCase) || p == preferredMscorlib)
            .ToArray();
        _bySimpleName = paths
            .GroupBy(path => Path.GetFileNameWithoutExtension(path), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        if (Program.DebugEnabled)
        {
            Console.Error.WriteLine($"[inspector] resolver initialized with {paths.Length} paths (preferred mscorlib: {preferredMscorlib ?? "none"})");
        }
    }

    public override Assembly? Resolve(MetadataLoadContext context, AssemblyName assemblyName)
    {
        var name = assemblyName.Name ?? string.Empty;

        var existing = context.GetAssemblies()
            .FirstOrDefault(a => string.Equals(a.GetName().Name, name, StringComparison.OrdinalIgnoreCase));
        if (existing != null)
        {
            if (Program.DebugEnabled)
            {
                Console.Error.WriteLine($"[inspector] resolved {assemblyName} -> already loaded {existing.Location}");
            }
            return existing;
        }

        if (_bySimpleName.TryGetValue(name, out var path))
        {
            try
            {
                var loaded = context.LoadFromAssemblyPath(path);
                if (Program.DebugEnabled)
                {
                    Console.Error.WriteLine($"[inspector] loaded {assemblyName} -> {path}");
                }
                return loaded;
            }
            catch (FileLoadException fle)
            {
                existing = context.GetAssemblies()
                    .FirstOrDefault(a => string.Equals(a.GetName().Name, name, StringComparison.OrdinalIgnoreCase));
                if (existing != null)
                {
                    if (Program.DebugEnabled)
                    {
                        Console.Error.WriteLine($"[inspector] returning existing for {assemblyName} after FileLoadException: {existing.Location} ({fle.Message})");
                    }
                    return existing;
                }
            }
        }

        if (Program.DebugEnabled)
        {
            Console.Error.WriteLine($"[inspector] failed to resolve {assemblyName}");
        }
        return null;
    }
}
