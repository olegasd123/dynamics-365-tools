import * as path from "path";
import type { WorkspaceFilesPort } from "@app/ports/files";
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
  constructor(private readonly files: WorkspaceFilesPort) {}

  get workspaceRoot(): string | undefined {
    return this.files.workspaceRoot;
  }

  async loadConfiguration(): Promise<Dynamics365Configuration> {
    const existing = await this.loadExistingConfiguration();
    if (existing) {
      return existing;
    }
    return {
      environments: [],
      solutions: [],
    };
  }

  async loadExistingConfiguration(): Promise<Dynamics365Configuration | undefined> {
    const configPath = this.getConfigPath();
    const exists = await this.files.exists(configPath);
    if (!exists) {
      return undefined;
    }

    const content = await this.files.readFile(configPath);
    return configurationSchema.parse(this.parseJson(content, CONFIG_FILENAME));
  }

  async saveConfiguration(config: Dynamics365Configuration): Promise<void> {
    const configPath = this.getConfigPath();
    await this.ensureVscodeFolder();
    await this.files.writeFile(configPath, Buffer.from(JSON.stringify(config, null, 2), "utf8"));
  }

  async loadBindings(): Promise<BindingSnapshot> {
    const bindingsPath = this.getBindingsPath();
    const exists = await this.files.exists(bindingsPath);
    if (!exists) {
      const empty: BindingSnapshot = { bindings: [] };
      await this.saveBindings(empty);
      return empty;
    }

    const content = await this.files.readFile(bindingsPath);
    return bindingsSchema.parse(this.parseJson(content, "dynamics365tools.bindings.json"));
  }

  async loadExistingBindings(): Promise<BindingSnapshot | undefined> {
    const bindingsPath = this.getBindingsPath();
    const exists = await this.files.exists(bindingsPath);
    if (!exists) {
      return undefined;
    }

    const content = await this.files.readFile(bindingsPath);
    return bindingsSchema.parse(this.parseJson(content, "dynamics365tools.bindings.json"));
  }

  async saveBindings(snapshot: BindingSnapshot): Promise<void> {
    const bindingsPath = this.getBindingsPath();
    await this.ensureVscodeFolder();
    await this.files.writeFile(
      bindingsPath,
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

  private getConfigPath(): string {
    return this.ensureWorkspacePath(CONFIG_FILENAME);
  }

  private getBindingsPath(): string {
    return this.ensureWorkspacePath(BINDINGS_FILENAME);
  }

  private ensureWorkspacePath(filename: string): string {
    if (!this.workspaceRoot) {
      throw new Error("This extension requires an opened workspace folder.");
    }

    return path.join(this.workspaceRoot, ".vscode", filename);
  }

  private async ensureVscodeFolder(): Promise<void> {
    if (!this.workspaceRoot) {
      return;
    }

    const vscodeDir = path.join(this.workspaceRoot, ".vscode");
    const exists = await this.files.exists(vscodeDir);
    if (!exists) {
      await this.files.createDirectory(vscodeDir);
    }
  }

  private parseJson(content: Uint8Array, filename: string): unknown {
    try {
      return JSON.parse(Buffer.from(content).toString("utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${filename} contains invalid JSON: ${message}`);
    }
  }
}
