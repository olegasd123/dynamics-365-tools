import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface DiscoveredPluginType {
  typeName: string;
  name?: string;
  friendlyName?: string;
}

export interface AssemblyIdentity {
  name: string;
  version?: string;
  culture?: string;
  publicKeyToken?: string;
}

export interface PluginAssemblyInspection {
  assembly: AssemblyIdentity;
  plugins: DiscoveredPluginType[];
}

export class PluginAssemblyIntrospector {
  private readonly inspectorProjectPath: string;
  private readonly inspectorOutputPath: string;
  private buildPromise?: Promise<void>;

  constructor(extensionRoot: string) {
    this.inspectorProjectPath = path.join(
      extensionRoot,
      "dotnet",
      "plugin-inspector",
      "PluginInspector.csproj",
    );
    this.inspectorOutputPath = path.join(
      extensionRoot,
      "dotnet",
      "plugin-inspector",
      "bin",
      "Release",
      "net8.0",
      "PluginInspector.dll",
    );
  }

  async inspect(assemblyPath: string): Promise<PluginAssemblyInspection> {
    await this.ensureInspectorBuilt();

    try {
      const { stdout } = await execFileAsync("dotnet", [this.inspectorOutputPath, assemblyPath], {
        cwd: path.dirname(this.inspectorProjectPath),
      });
      const parsed = JSON.parse(stdout);
      if (!parsed?.plugins || !Array.isArray(parsed.plugins)) {
        throw new Error("Unexpected plugin inspector output.");
      }

      return {
        assembly: this.parseAssemblyIdentity(parsed.assembly),
        plugins: this.parsePlugins(parsed.plugins),
      };
    } catch (error) {
      const stderr = (error as { stderr?: string })?.stderr;
      const message = stderr ? `${String(error)}: ${stderr}` : String(error);
      throw new Error(`Failed to inspect plugin assembly with MetadataLoadContext: ${message}`);
    }
  }

  async discover(assemblyPath: string): Promise<DiscoveredPluginType[]> {
    const inspection = await this.inspect(assemblyPath);
    return inspection.plugins;
  }

  private parseAssemblyIdentity(value: unknown): AssemblyIdentity {
    if (!value || typeof value !== "object") {
      throw new Error("Unexpected plugin inspector output.");
    }

    const record = value as Record<string, unknown>;
    const name = String(record.name ?? "").trim();
    if (!name) {
      throw new Error("Unexpected plugin inspector output.");
    }

    return {
      name,
      version: this.optionalString(record.version),
      culture: this.optionalString(record.culture),
      publicKeyToken: this.optionalString(record.publicKeyToken),
    };
  }

  private optionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private parsePlugins(value: unknown): DiscoveredPluginType[] {
    if (!Array.isArray(value)) {
      throw new Error("Unexpected plugin inspector output.");
    }

    return value
      .map((plugin: Record<string, unknown>) => ({
        typeName: String(plugin.typeName ?? plugin.typename ?? ""),
        name: plugin.name ? String(plugin.name) : undefined,
        friendlyName: plugin.friendlyName ? String(plugin.friendlyName) : undefined,
      }))
      .filter((plugin: DiscoveredPluginType) => plugin.typeName);
  }

  private async ensureInspectorBuilt(): Promise<void> {
    if (!this.buildPromise) {
      this.buildPromise = this.doEnsureInspectorBuilt().catch((error) => {
        this.buildPromise = undefined;
        throw error;
      });
    }

    return this.buildPromise;
  }

  private async doEnsureInspectorBuilt(): Promise<void> {
    if (!(await this.shouldBuildInspector())) {
      return;
    }

    if (!(await this.fileExists(this.inspectorProjectPath))) {
      throw new Error("Plugin inspector project is missing from the extension.");
    }

    try {
      await execFileAsync("dotnet", ["build", this.inspectorProjectPath, "-c", "Release"], {
        cwd: path.dirname(this.inspectorProjectPath),
      });
    } catch (error) {
      const stderr = (error as { stderr?: string })?.stderr;
      const missingDotnet = (error as { code?: string })?.code === "ENOENT";
      const message =
        stderr?.trim() ||
        (missingDotnet
          ? "dotnet CLI is not available on PATH. Install the .NET SDK to enable plugin discovery."
          : undefined);
      throw new Error(message ?? `Failed to build plugin inspector: ${String(error)}`);
    }

    if (!(await this.fileExists(this.inspectorOutputPath))) {
      throw new Error("Plugin inspector build completed but output is missing.");
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async shouldBuildInspector(): Promise<boolean> {
    let outputStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      outputStat = await fs.stat(this.inspectorOutputPath);
    } catch {
      return true;
    }

    const sourcePaths = [
      this.inspectorProjectPath,
      path.join(path.dirname(this.inspectorProjectPath), "Program.cs"),
    ];

    for (const sourcePath of sourcePaths) {
      try {
        const sourceStat = await fs.stat(sourcePath);
        if (sourceStat.mtimeMs > outputStat.mtimeMs) {
          return true;
        }
      } catch {
        return true;
      }
    }

    return false;
  }
}
