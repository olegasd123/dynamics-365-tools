export interface WorkbenchPort {
  readonly hasWorkspace: boolean;

  executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>;
  openWorkspaceFile(relativePath: string): Promise<void>;
  setStatusBarMessage(message: string, hideWhenDone: Promise<unknown>): void;
}
