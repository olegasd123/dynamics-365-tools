import * as vscode from "vscode";
import { WorkspaceFileType } from "../../app/ports/files";
import type { WorkspaceFileStat, WorkspaceFilesPort } from "../../app/ports/files";

export class VsCodeWorkspaceFiles implements WorkspaceFilesPort {
  get workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  async stat(fsPath: string): Promise<WorkspaceFileStat> {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
    return {
      type: toWorkspaceFileType(stat.type),
      ctime: stat.ctime,
      mtime: stat.mtime,
      size: stat.size,
    };
  }

  async exists(fsPath: string): Promise<boolean> {
    try {
      await this.stat(fsPath);
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

function toWorkspaceFileType(type: vscode.FileType): WorkspaceFileType {
  switch (type) {
    case vscode.FileType.File:
      return WorkspaceFileType.File;
    case vscode.FileType.Directory:
      return WorkspaceFileType.Directory;
    case vscode.FileType.SymbolicLink:
      return WorkspaceFileType.SymbolicLink;
    default:
      return WorkspaceFileType.Unknown;
  }
}
