export interface WorkspaceFilesPort {
  readonly workspaceRoot: string | undefined;

  exists(fsPath: string): Promise<boolean>;
  readFile(fsPath: string): Promise<Uint8Array>;
  writeFile(fsPath: string, content: Uint8Array): Promise<void>;
  createDirectory(fsPath: string): Promise<void>;
}
