import * as vscode from "vscode";

const LAST_ENV_KEY = "dynamics365tools.lastEnvironment";
const LAST_ASSEMBLY_PATHS_KEY = "dynamics365tools.lastAssemblyDllPaths";

/**
 * Stores user choices per workspace so we can preselect them later.
 */
export class LastSelectionService {
  constructor(private readonly state: vscode.Memento) {}

  async setLastEnvironment(envName: string): Promise<void> {
    await this.state.update(LAST_ENV_KEY, envName);
  }

  getLastEnvironment(): string | undefined {
    return this.state.get<string>(LAST_ENV_KEY);
  }

  async setLastAssemblyDllPath(
    envName: string,
    assemblyId: string,
    filePath: string,
  ): Promise<void> {
    const cache = this.state.get<Record<string, string>>(LAST_ASSEMBLY_PATHS_KEY) ?? {};
    cache[this.buildAssemblyKey(envName, assemblyId)] = filePath;
    await this.state.update(LAST_ASSEMBLY_PATHS_KEY, cache);
  }

  getLastAssemblyDllPath(envName: string, assemblyId: string): string | undefined {
    const cache = this.state.get<Record<string, string>>(LAST_ASSEMBLY_PATHS_KEY) ?? {};
    return cache[this.buildAssemblyKey(envName, assemblyId)];
  }

  private buildAssemblyKey(envName: string, assemblyId: string): string {
    return `${envName}::${assemblyId}`;
  }
}
