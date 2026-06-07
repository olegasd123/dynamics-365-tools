import * as path from "path";
import { WorkspaceFileType, type FsPathTarget, type WorkspaceFilesPort } from "@app/ports/files";
import { NoopNotificationService, NotificationPort } from "@app/ports/notifications";
import type { CancellationTokenLike } from "@app/ports/progress";
import { WEB_RESOURCE_SUPPORTED_EXTENSIONS } from "@features/config/configurationService";

export function buildSupportedSet(): Set<string> {
  return new Set(WEB_RESOURCE_SUPPORTED_EXTENSIONS.map((ext) => ext.toLowerCase()));
}

export async function ensureSupportedResource(
  uri: FsPathTarget,
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
  folder: FsPathTarget,
  supportedExtensions: Set<string>,
  workspaceFiles: WorkspaceFilesPort,
  cancellationToken?: CancellationTokenLike,
): Promise<FsPathTarget[]> {
  const files: FsPathTarget[] = [];
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
        files.push({ fsPath: child });
      }
    }
  }

  return files;
}

function isSupportedExtension(ext: string, supportedExtensions: Set<string>): boolean {
  return supportedExtensions.has(ext);
}
