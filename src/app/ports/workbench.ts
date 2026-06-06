export interface WorkbenchPort {
  readonly hasWorkspace: boolean;

  executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>;
  openWorkspaceFile(relativePath: string): Promise<void>;
  openExternal(url: string): Promise<boolean>;
  setStatusBarMessage(message: string, hideWhenDone: Promise<unknown>): void;
}

export class NoopWorkbench implements WorkbenchPort {
  readonly hasWorkspace = false;

  async executeCommand(): Promise<unknown> {
    return undefined;
  }

  async openWorkspaceFile(): Promise<void> {}

  async openExternal(): Promise<boolean> {
    return false;
  }

  setStatusBarMessage(): void {}
}
