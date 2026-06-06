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

export interface WorkspaceFilesPort {
  readonly workspaceRoot: string | undefined;

  stat(fsPath: string): Promise<WorkspaceFileStat>;
  exists(fsPath: string): Promise<boolean>;
  readFile(fsPath: string): Promise<Uint8Array>;
  writeFile(fsPath: string, content: Uint8Array): Promise<void>;
  createDirectory(fsPath: string): Promise<void>;
}
