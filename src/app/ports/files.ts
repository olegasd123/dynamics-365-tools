export enum WorkspaceFileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export interface WorkspaceFileStat {
  type: WorkspaceFileType;
  ctime: number;
  mtime: number;
  size: number;
}

export interface WorkspaceDirectoryEntry {
  name: string;
  type: WorkspaceFileType;
}

export interface FsPathTarget {
  readonly fsPath: string;
}

export interface WorkspaceFilesPort {
  readonly workspaceRoot: string | undefined;
  readonly workspaceFolders: readonly string[];

  stat(fsPath: string): Promise<WorkspaceFileStat>;
  exists(fsPath: string): Promise<boolean>;
  readDirectory(fsPath: string): Promise<WorkspaceDirectoryEntry[]>;
  readFile(fsPath: string): Promise<Uint8Array>;
  writeFile(fsPath: string, content: Uint8Array): Promise<void>;
  createDirectory(fsPath: string): Promise<void>;
}
