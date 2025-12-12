import * as vscode from "vscode";
import * as path from "path";
import { WEB_RESOURCE_SUPPORTED_EXTENSIONS } from "../services/configurationService";

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
): Promise<vscode.Uri[]> {
  const entries = await vscode.workspace.fs.readDirectory(folder);
  const files: vscode.Uri[] = [];

  for (const [name, type] of entries) {
    const child = vscode.Uri.joinPath(folder, name);
    if (type === vscode.FileType.Directory) {
      files.push(...(await collectSupportedFiles(child, supportedExtensions)));
    } else if (
      type === vscode.FileType.File &&
      isSupportedExtension(path.extname(name).toLowerCase(), supportedExtensions)
    ) {
      files.push(child);
    }
  }

  return files;
}

function isSupportedExtension(ext: string, supportedExtensions: Set<string>): boolean {
  return supportedExtensions.has(ext);
}
