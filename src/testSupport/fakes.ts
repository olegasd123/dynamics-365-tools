import * as fs from "fs/promises";
import * as path from "path";
import type { WorkspaceFilesPort } from "../app/ports/files";
import type { LoggerPort, LogMetadata } from "../app/ports/logger";
import type { NotificationPort } from "../app/ports/notifications";
import type { SecretStorePort, StateStorePort } from "../app/ports/storage";
import type { WorkbenchPort } from "../app/ports/workbench";

export class NodeWorkspaceFiles implements WorkspaceFilesPort {
  constructor(public workspaceRoot: string | undefined) {}

  async exists(fsPath: string): Promise<boolean> {
    return fs
      .stat(fsPath)
      .then(() => true)
      .catch(() => false);
  }

  async readFile(fsPath: string): Promise<Uint8Array> {
    return fs.readFile(fsPath);
  }

  async writeFile(fsPath: string, content: Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(fsPath), { recursive: true });
    await fs.writeFile(fsPath, content);
  }

  async createDirectory(fsPath: string): Promise<void> {
    await fs.mkdir(fsPath, { recursive: true });
  }
}

export class MemorySecretStore implements SecretStorePort {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

export class MemoryStateStore implements StateStorePort {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    if (!this.values.has(key)) {
      return defaultValue;
    }
    return this.values.get(key) as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
      return;
    }
    this.values.set(key, value);
  }
}

export class RecordingNotifications implements NotificationPort {
  readonly infos: string[] = [];
  readonly warnings: string[] = [];
  readonly errors: string[] = [];

  nextInfoAction: string | undefined;
  nextWarningAction: string | undefined;
  nextErrorAction: string | undefined;

  async info(message: string): Promise<void> {
    this.infos.push(message);
  }

  async warning(message: string): Promise<void> {
    this.warnings.push(message);
  }

  async error(message: string): Promise<void> {
    this.errors.push(message);
  }

  async askInfo<T extends string>(message: string): Promise<T | undefined> {
    this.infos.push(message);
    return this.nextInfoAction as T | undefined;
  }

  async askWarning<T extends string>(message: string): Promise<T | undefined> {
    this.warnings.push(message);
    return this.nextWarningAction as T | undefined;
  }

  async askError<T extends string>(message: string): Promise<T | undefined> {
    this.errors.push(message);
    return this.nextErrorAction as T | undefined;
  }
}

export class RecordingWorkbench implements WorkbenchPort {
  readonly commands: string[] = [];
  readonly openedFiles: string[] = [];
  readonly statusMessages: string[] = [];

  constructor(public hasWorkspace: boolean) {}

  async executeCommand(commandId: string): Promise<unknown> {
    this.commands.push(commandId);
    return undefined;
  }

  async openWorkspaceFile(relativePath: string): Promise<void> {
    this.openedFiles.push(relativePath);
  }

  setStatusBarMessage(message: string): void {
    this.statusMessages.push(message);
  }
}

export class TestLogger implements LoggerPort {
  readonly errors: Array<{ message: string; error?: unknown; metadata?: LogMetadata }> = [];
  shown = false;

  info(): void {}

  error(message: string, error?: unknown, metadata?: LogMetadata): void {
    this.errors.push({ message, error, metadata });
  }

  show(): void {
    this.shown = true;
  }
}
