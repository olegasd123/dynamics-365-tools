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

  async discover(assemblyPath: string): Promise<DiscoveredPluginType[]> {
    await this.ensureInspectorBuilt();

    try {
      const { stdout } = await execFileAsync("dotnet", [this.inspectorOutputPath, assemblyPath], {
        cwd: path.dirname(this.inspectorProjectPath),
      });
      const parsed = JSON.parse(stdout);
      if (!parsed?.plugins || !Array.isArray(parsed.plugins)) {
        throw new Error("Unexpected plugin inspector output.");
      }

      return parsed.plugins
        .map((plugin: Record<string, unknown>) => ({
          typeName: String(plugin.typeName ?? plugin.typename ?? ""),
          name: plugin.name ? String(plugin.name) : undefined,
          friendlyName: plugin.friendlyName ? String(plugin.friendlyName) : undefined,
        }))
        .filter((plugin: DiscoveredPluginType) => plugin.typeName);
    } catch (error) {
      const stderr = (error as { stderr?: string })?.stderr;
      const message = stderr ? `${String(error)}: ${stderr}` : String(error);
      throw new Error(`Failed to inspect plugin assembly with MetadataLoadContext: ${message}`);
    }
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
    if (await this.fileExists(this.inspectorOutputPath)) {
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
}
