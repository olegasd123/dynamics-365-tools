import * as vscode from "vscode";
import type { WorkspaceFilesPort } from "../../app/ports/files";

export class VsCodeWorkspaceFiles implements WorkspaceFilesPort {
  get workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  async exists(fsPath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
      return true;
    } catch {
      return false;
    }
  }

  async readFile(fsPath: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
  }

  async writeFile(fsPath: string, content: Uint8Array): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(fsPath), content);
  }

  async createDirectory(fsPath: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(fsPath));
  }
}
