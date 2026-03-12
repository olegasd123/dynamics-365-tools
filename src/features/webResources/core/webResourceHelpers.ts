import * as vscode from "vscode";
import * as path from "path";
import { WEB_RESOURCE_SUPPORTED_EXTENSIONS } from "../../config/configurationService";

export function buildSupportedSet(): Set<string> {
  return new Set(WEB_RESOURCE_SUPPORTED_EXTENSIONS.map((ext) => ext.toLowerCase()));
}

export async function ensureSupportedResource(
  uri: vscode.Uri,
  supportedExtensions: Set<string>,
): Promise<boolean> {
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.type === vscode.FileType.Directory) {
    return true;
  }

  const ext = path.extname(uri.fsPath).toLowerCase();
  if (!isSupportedExtension(ext, supportedExtensions)) {
    vscode.window.showInformationMessage(
      "Dynamics 365 Tools actions are available only for supported web resource types.",
    );
    return false;
  }

  return true;
}

export async function collectSupportedFiles(
  folder: vscode.Uri,
  supportedExtensions: Set<string>,
  cancellationToken?: vscode.CancellationToken,
): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  const pendingFolders: vscode.Uri[] = [folder];

  while (pendingFolders.length) {
    if (cancellationToken?.isCancellationRequested) {
      break;
    }

    const currentFolder = pendingFolders.pop();
    if (!currentFolder) {
      break;
    }

    const entries = await vscode.workspace.fs.readDirectory(currentFolder);
    for (const [name, type] of entries) {
      if (cancellationToken?.isCancellationRequested) {
        break;
      }

      const child = vscode.Uri.joinPath(currentFolder, name);
      if (type === vscode.FileType.Directory) {
        pendingFolders.push(child);
      } else if (
        type === vscode.FileType.File &&
        isSupportedExtension(path.extname(name).toLowerCase(), supportedExtensions)
      ) {
        files.push(child);
      }
    }
  }

  return files;
}

function isSupportedExtension(ext: string, supportedExtensions: Set<string>): boolean {
  return supportedExtensions.has(ext);
}
