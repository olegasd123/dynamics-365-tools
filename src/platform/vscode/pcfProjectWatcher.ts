import * as vscode from "vscode";

const MANIFEST_FILENAME = "ControlManifest.Input.xml";

export function watchPcfManifests(onChange: () => void): vscode.Disposable | undefined {
  if (!vscode.workspace.createFileSystemWatcher) {
    return undefined;
  }

  const watcher = vscode.workspace.createFileSystemWatcher(`**/${MANIFEST_FILENAME}`);
  watcher.onDidCreate(onChange);
  watcher.onDidChange(onChange);
  watcher.onDidDelete(onChange);
  return watcher;
}
