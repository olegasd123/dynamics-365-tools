import * as vscode from "vscode";
import * as path from "path";
import { BindingSnapshot, Dynamics365Configuration, BindingEntry } from "./domain/models";
import { configurationSchema, bindingsSchema } from "./schema";

export const WEB_RESOURCE_SUPPORTED_EXTENSIONS = [
  ".js",
  ".css",
  ".htm",
  ".html",
  ".xml",
  ".json",
  ".resx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".xsl",
  ".xslt",
  ".ico",
  ".svg",
];

const CONFIG_FILENAME = "dynamics365tools.config.json";
const BINDINGS_FILENAME = "dynamics365tools.bindings.json";

export class ConfigurationService {
  private readonly workspaceFolder: vscode.WorkspaceFolder | undefined;

  constructor() {
    this.workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  }

  get workspaceRoot(): string | undefined {
    return this.workspaceFolder?.uri.fsPath;
  }

  async loadConfiguration(): Promise<Dynamics365Configuration> {
    const existing = await this.loadExistingConfiguration();
    if (existing) {
      return existing;
    }

    const defaults: Dynamics365Configuration = {
      environments: [
        {
          name: "dev",
          url: "https://your-dev.crm.dynamics.com",
          authType: "interactive",
          createMissingComponents: false,
          userAgentEnabled: false,
        },
        {
          name: "test",
          url: "https://your-test.crm.dynamics.com",
          authType: "interactive",
          createMissingComponents: false,
          userAgentEnabled: false,
        },
        {
          name: "prod",
          url: "https://your-prod.crm.dynamics.com",
          authType: "interactive",
          createMissingComponents: false,
          userAgentEnabled: false,
        },
      ],
      solutions: [
        {
          name: "CoreWebResources",
          prefix: "new_",
        },
        {
          name: "ComponentWebResources",
          prefix: "cmp_",
        },
      ],
    };
    await this.saveConfiguration(defaults);
    return defaults;
  }

  async loadExistingConfiguration(): Promise<Dynamics365Configuration | undefined> {
    const uri = this.getConfigUri();
    const exists = await this.exists(uri);
    if (!exists) {
      return undefined;
    }

    const content = await vscode.workspace.fs.readFile(uri);
    return configurationSchema.parse(this.parseJson(content, CONFIG_FILENAME));
  }

  async saveConfiguration(config: Dynamics365Configuration): Promise<void> {
    const uri = this.getConfigUri();
    await this.ensureVscodeFolder();
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(config, null, 2), "utf8"));
  }

  async loadBindings(): Promise<BindingSnapshot> {
    const uri = this.getBindingsUri();
    const exists = await this.exists(uri);
    if (!exists) {
      const empty: BindingSnapshot = { bindings: [] };
      await this.saveBindings(empty);
      return empty;
    }

    const content = await vscode.workspace.fs.readFile(uri);
    return bindingsSchema.parse(this.parseJson(content, "dynamics365tools.bindings.json"));
  }

  async saveBindings(snapshot: BindingSnapshot): Promise<void> {
    const uri = this.getBindingsUri();
    await this.ensureVscodeFolder();
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(snapshot, null, 2), "utf8"),
    );
  }

  createBinding(partial: BindingEntry): BindingEntry {
    if (!this.workspaceRoot) {
      throw new Error("No workspace folder detected.");
    }

    const normalizedLocal = path.normalize(partial.relativeLocalPath);
    const workspaceName = path.basename(this.workspaceRoot);
    const isInsideWorkspace =
      normalizedLocal.startsWith(this.workspaceRoot + path.sep) ||
      normalizedLocal === this.workspaceRoot;

    let storedPath = normalizedLocal;
    if (isInsideWorkspace) {
      const relative = path.relative(this.workspaceRoot, normalizedLocal);
      storedPath = relative ? path.join(workspaceName, relative) : workspaceName;
    }

    return {
      ...partial,
      relativeLocalPath: storedPath,
    };
  }

  getRelativeToWorkspace(fsPath: string): string {
    if (!this.workspaceRoot) {
      return fsPath;
    }

    return path.relative(this.workspaceRoot, fsPath);
  }

  resolveLocalPath(fsPath: string): string {
    if (path.isAbsolute(fsPath)) {
      return path.normalize(fsPath);
    }

    if (!this.workspaceRoot) {
      return path.normalize(fsPath);
    }

    const workspaceName = path.basename(this.workspaceRoot);
    const segments = fsPath.split(path.sep);
    if (segments[0] === workspaceName) {
      segments.shift();
    }

    return path.normalize(path.join(this.workspaceRoot, ...segments));
  }

  private getConfigUri(): vscode.Uri {
    return this.ensureWorkspaceUri(CONFIG_FILENAME);
  }

  private getBindingsUri(): vscode.Uri {
    return this.ensureWorkspaceUri(BINDINGS_FILENAME);
  }

  private ensureWorkspaceUri(filename: string): vscode.Uri {
    if (!this.workspaceFolder) {
      throw new Error("This extension requires an opened workspace folder.");
    }

    return vscode.Uri.joinPath(this.workspaceFolder.uri, ".vscode", filename);
  }

  private async ensureVscodeFolder(): Promise<void> {
    if (!this.workspaceFolder) {
      return;
    }

    const vscodeDir = vscode.Uri.joinPath(this.workspaceFolder.uri, ".vscode");
    const exists = await this.exists(vscodeDir);
    if (!exists) {
      await vscode.workspace.fs.createDirectory(vscodeDir);
    }
  }

  private async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private parseJson(content: Uint8Array, filename: string): unknown {
    try {
      return JSON.parse(content.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${filename} contains invalid JSON: ${message}`);
    }
  }
}
