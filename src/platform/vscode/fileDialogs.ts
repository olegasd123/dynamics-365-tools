import * as vscode from "vscode";
import type { FileDialogPort, OpenFileDialogOptions } from "@app/ports/fileDialogs";

export class VsCodeFileDialogs implements FileDialogPort {
  async showOpenDialog(options: OpenFileDialogOptions): Promise<string[] | undefined> {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: options.canSelectFiles,
      canSelectFolders: options.canSelectFolders,
      canSelectMany: options.canSelectMany,
      defaultUri: options.defaultPath ? vscode.Uri.file(options.defaultPath) : undefined,
      filters: options.filters,
      openLabel: options.openLabel,
      title: options.title,
    });
    return selection?.map((uri) => uri.fsPath);
  }
}
