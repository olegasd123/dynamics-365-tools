import * as vscode from "vscode";
import type { WorkbenchPort } from "@app/ports/workbench";

export class VsCodeWorkbench implements WorkbenchPort {
  get hasWorkspace(): boolean {
    return Boolean(vscode.workspace.workspaceFolders?.length);
  }

  get activeFilePath(): string | undefined {
    return vscode.window.activeTextEditor?.document.uri.fsPath;
  }

  async executeCommand(commandId: string, ...args: unknown[]): Promise<unknown> {
    return vscode.commands.executeCommand(commandId, ...args);
  }

  async openWorkspaceFile(relativePath: string): Promise<void> {
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceUri) {
      return;
    }

    const fileUri = vscode.Uri.joinPath(workspaceUri, ...relativePath.split("/"));
    await vscode.window.showTextDocument(fileUri);
  }

  async openExternal(url: string): Promise<boolean> {
    return vscode.env.openExternal(vscode.Uri.parse(url));
  }

  setStatusBarMessage(message: string, hideWhenDone: Promise<unknown>): void {
    vscode.window.setStatusBarMessage(message, hideWhenDone);
  }
}
