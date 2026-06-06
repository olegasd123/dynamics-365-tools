import * as vscode from "vscode";
import * as path from "path";
import { WorkspaceFileType, type WorkspaceFilesPort } from "../../../app/ports/files";
import { NoopNotificationService, NotificationPort } from "../../../app/ports/notifications";
import { WEB_RESOURCE_SUPPORTED_EXTENSIONS } from "../../config/configurationService";

export function buildSupportedSet(): Set<string> {
  return new Set(WEB_RESOURCE_SUPPORTED_EXTENSIONS.map((ext) => ext.toLowerCase()));
}

export async function ensureSupportedResource(
  uri: vscode.Uri,
  supportedExtensions: Set<string>,
  files: WorkspaceFilesPort,
  notifications: NotificationPort = new NoopNotificationService(),
): Promise<boolean> {
  const stat = await files.stat(uri.fsPath);
  if (stat.type === WorkspaceFileType.Directory) {
    return true;
  }

  const ext = path.extname(uri.fsPath).toLowerCase();
  if (!isSupportedExtension(ext, supportedExtensions)) {
    await notifications.info(
      "Dynamics 365 Tools actions are available only for supported web resource types.",
    );
    return false;
  }

  return true;
}

export async function collectSupportedFiles(
  folder: vscode.Uri,
  supportedExtensions: Set<string>,
  workspaceFiles: WorkspaceFilesPort,
  cancellationToken?: vscode.CancellationToken,
): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  const pendingFolders: string[] = [folder.fsPath];

  while (pendingFolders.length) {
    if (cancellationToken?.isCancellationRequested) {
      break;
    }

    const currentFolder = pendingFolders.pop();
    if (!currentFolder) {
      break;
    }

    const entries = await workspaceFiles.readDirectory(currentFolder);
    for (const { name, type } of entries) {
      if (cancellationToken?.isCancellationRequested) {
        break;
      }

      const child = path.join(currentFolder, name);
      if (type === WorkspaceFileType.Directory) {
        pendingFolders.push(child);
      } else if (
        type === WorkspaceFileType.File &&
        isSupportedExtension(path.extname(name).toLowerCase(), supportedExtensions)
      ) {
        files.push(vscode.Uri.file(child));
      }
    }
  }

  return files;
}

function isSupportedExtension(ext: string, supportedExtensions: Set<string>): boolean {
  return supportedExtensions.has(ext);
}
