export interface WorkbenchPort {
  readonly hasWorkspace: boolean;

  executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>;
  openWorkspaceFile(relativePath: string): Promise<void>;
  openExternal(url: string): Promise<boolean>;
  setStatusBarMessage(message: string, hideWhenDone: Promise<unknown>): void;
}
