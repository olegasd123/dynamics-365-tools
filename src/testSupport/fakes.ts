import * as fs from "fs/promises";
import * as path from "path";
import type { ClipboardPort } from "../app/ports/clipboard";
import type { DiagnosticEntry, DiagnosticPort } from "../app/ports/diagnostics";
import type { FileDialogPort, OpenFileDialogOptions } from "../app/ports/fileDialogs";
import { WorkspaceFileType } from "../app/ports/files";
import type {
  WorkspaceDirectoryEntry,
  WorkspaceFileStat,
  WorkspaceFilesPort,
} from "../app/ports/files";
import type { TextInputOptions, TextInputPort } from "../app/ports/input";
import type { LoggerPort, LogMetadata } from "../app/ports/logger";
import type { NotificationOptions, NotificationPort } from "../app/ports/notifications";
import type { OutputChannelPort, OutputPort } from "../app/ports/output";
import type {
  CancellationTokenLike,
  ProgressOptions,
  ProgressPort,
  ProgressReporter,
} from "../app/ports/progress";
import type { SecretStorePort, StateStorePort } from "../app/ports/storage";
import type { WorkbenchPort } from "../app/ports/workbench";

export class NodeWorkspaceFiles implements WorkspaceFilesPort {
  constructor(public workspaceRoot: string | undefined) {}

  get workspaceFolders(): readonly string[] {
    return this.workspaceRoot ? [this.workspaceRoot] : [];
  }

  async stat(fsPath: string): Promise<WorkspaceFileStat> {
    const stats = await fs.stat(fsPath);
    return {
      type: stats.isDirectory() ? WorkspaceFileType.Directory : WorkspaceFileType.File,
      ctime: stats.ctimeMs,
      mtime: stats.mtimeMs,
      size: stats.size,
    };
  }

  async exists(fsPath: string): Promise<boolean> {
    return this.stat(fsPath)
      .then(() => true)
      .catch(() => false);
  }

  async readDirectory(fsPath: string): Promise<WorkspaceDirectoryEntry[]> {
    const entries = await fs.readdir(fsPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory()
        ? WorkspaceFileType.Directory
        : entry.isFile()
          ? WorkspaceFileType.File
          : WorkspaceFileType.Unknown,
    }));
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

type MemoryFileEntry = WorkspaceFileStat & {
  content?: Uint8Array;
};

export class MemoryWorkspaceFiles implements WorkspaceFilesPort {
  private readonly entries = new Map<string, MemoryFileEntry>();
  private clock = 1;

  constructor(public workspaceRoot: string | undefined) {
    if (workspaceRoot) {
      this.addDirectory(workspaceRoot);
    }
  }

  get workspaceFolders(): readonly string[] {
    return this.workspaceRoot ? [this.workspaceRoot] : [];
  }

  addFile(fsPath: string, content: string | Uint8Array): void {
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    this.addDirectory(path.dirname(fsPath));
    this.entries.set(this.normalize(fsPath), {
      type: WorkspaceFileType.File,
      ctime: this.clock,
      mtime: this.clock++,
      size: bytes.byteLength,
      content: bytes,
    });
  }

  addDirectory(fsPath: string): void {
    const normalized = this.normalize(fsPath);
    const parent = path.dirname(normalized);
    if (parent && parent !== normalized && !this.entries.has(parent)) {
      this.addDirectory(parent);
    }
    if (!this.entries.has(normalized)) {
      this.entries.set(normalized, {
        type: WorkspaceFileType.Directory,
        ctime: this.clock,
        mtime: this.clock++,
        size: 0,
      });
    }
  }

  async stat(fsPath: string): Promise<WorkspaceFileStat> {
    const entry = this.getEntry(fsPath);
    const { type, ctime, mtime, size } = entry;
    return { type, ctime, mtime, size };
  }

  async exists(fsPath: string): Promise<boolean> {
    return this.entries.has(this.normalize(fsPath));
  }

  async readDirectory(fsPath: string): Promise<WorkspaceDirectoryEntry[]> {
    const normalized = this.normalize(fsPath);
    const entry = this.getEntry(normalized);
    if (entry.type !== WorkspaceFileType.Directory) {
      throw Object.assign(new Error(`Path is not a directory: ${fsPath}`), { code: "ENOTDIR" });
    }

    const children: WorkspaceDirectoryEntry[] = [];
    for (const [entryPath, child] of this.entries) {
      if (entryPath !== normalized && path.dirname(entryPath) === normalized) {
        children.push({ name: path.basename(entryPath), type: child.type });
      }
    }
    return children;
  }

  async readFile(fsPath: string): Promise<Uint8Array> {
    const entry = this.getEntry(fsPath);
    if (entry.type !== WorkspaceFileType.File || !entry.content) {
      throw Object.assign(new Error(`File not found: ${fsPath}`), { code: "ENOENT" });
    }
    return entry.content;
  }

  async writeFile(fsPath: string, content: Uint8Array): Promise<void> {
    this.addFile(fsPath, content);
  }

  async createDirectory(fsPath: string): Promise<void> {
    this.addDirectory(fsPath);
  }

  private getEntry(fsPath: string): MemoryFileEntry {
    const entry = this.entries.get(this.normalize(fsPath));
    if (!entry) {
      throw Object.assign(new Error(`Path not found: ${fsPath}`), { code: "ENOENT" });
    }
    return entry;
  }

  private normalize(fsPath: string): string {
    return path.normalize(fsPath);
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
  readonly infoPrompts: Array<{
    message: string;
    actions: readonly string[];
    options?: NotificationOptions;
  }> = [];
  readonly warningPrompts: Array<{
    message: string;
    actions: readonly string[];
    options?: NotificationOptions;
  }> = [];
  readonly errorPrompts: Array<{
    message: string;
    actions: readonly string[];
    options?: NotificationOptions;
  }> = [];

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

  async askInfo<T extends string>(
    message: string,
    actions: readonly T[] = [],
    options?: NotificationOptions,
  ): Promise<T | undefined> {
    this.infos.push(message);
    this.infoPrompts.push({ message, actions, options });
    return this.nextInfoAction as T | undefined;
  }

  async askWarning<T extends string>(
    message: string,
    actions: readonly T[] = [],
    options?: NotificationOptions,
  ): Promise<T | undefined> {
    this.warnings.push(message);
    this.warningPrompts.push({ message, actions, options });
    return this.nextWarningAction as T | undefined;
  }

  async askError<T extends string>(
    message: string,
    actions: readonly T[] = [],
    options?: NotificationOptions,
  ): Promise<T | undefined> {
    this.errors.push(message);
    this.errorPrompts.push({ message, actions, options });
    return this.nextErrorAction as T | undefined;
  }
}

export class RecordingFileDialogs implements FileDialogPort {
  readonly openDialogOptions: OpenFileDialogOptions[] = [];
  nextOpenSelections: Array<string[] | undefined> = [];

  async showOpenDialog(options: OpenFileDialogOptions): Promise<string[] | undefined> {
    this.openDialogOptions.push(options);
    return this.nextOpenSelections.shift();
  }
}

export class ImmediateProgress implements ProgressPort {
  readonly runs: ProgressOptions[] = [];
  readonly token: CancellationTokenLike = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  };

  async withProgress<T>(
    options: ProgressOptions,
    task: (progress: ProgressReporter, token: CancellationTokenLike) => Thenable<T>,
  ): Promise<T> {
    this.runs.push(options);
    return task({ report: () => undefined }, this.token);
  }
}

export class RecordingWorkbench implements WorkbenchPort {
  readonly commands: string[] = [];
  readonly openedFiles: string[] = [];
  readonly externalUrls: string[] = [];
  readonly statusMessages: string[] = [];
  openExternalResult = true;
  activeFilePath: string | undefined;

  constructor(public hasWorkspace: boolean) {}

  async executeCommand(commandId: string): Promise<unknown> {
    this.commands.push(commandId);
    return undefined;
  }

  async openWorkspaceFile(relativePath: string): Promise<void> {
    this.openedFiles.push(relativePath);
  }

  async openExternal(url: string): Promise<boolean> {
    this.externalUrls.push(url);
    return this.openExternalResult;
  }

  setStatusBarMessage(message: string): void {
    this.statusMessages.push(message);
  }
}

export class RecordingOutputChannel implements OutputChannelPort {
  readonly lines: string[] = [];
  shown = false;
  disposed = false;

  constructor(readonly name: string) {}

  appendLine(value: string): void {
    this.lines.push(value);
  }

  show(): void {
    this.shown = true;
  }

  dispose(): void {
    this.disposed = true;
  }
}

export class RecordingOutput implements OutputPort {
  readonly channels: RecordingOutputChannel[] = [];

  createChannel(name: string): RecordingOutputChannel {
    const channel = new RecordingOutputChannel(name);
    this.channels.push(channel);
    return channel;
  }
}

export class RecordingClipboard implements ClipboardPort {
  readonly values: string[] = [];
  failWrites = false;

  async writeText(value: string): Promise<void> {
    if (this.failWrites) {
      throw new Error("Clipboard write failed");
    }
    this.values.push(value);
  }
}

export class RecordingDiagnostics implements DiagnosticPort {
  readonly entries = new Map<string, DiagnosticEntry[]>();
  disposed = false;

  set(filePath: string, diagnostics: DiagnosticEntry[]): void {
    this.entries.set(filePath, diagnostics);
  }

  delete(filePath: string): void {
    this.entries.delete(filePath);
  }

  dispose(): void {
    this.disposed = true;
    this.entries.clear();
  }
}

export class RecordingTextInput implements TextInputPort {
  readonly prompts: TextInputOptions[] = [];
  nextValues: Array<string | undefined> = [];

  async showInputBox(options: TextInputOptions): Promise<string | undefined> {
    this.prompts.push(options);
    return this.nextValues.shift();
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
