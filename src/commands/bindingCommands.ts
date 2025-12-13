import * as vscode from "vscode";
import { ConfigurationService } from "../services/configurationService";
import { BindingService } from "../services/bindingService";
import { SolutionService } from "../services/solutionService";
import { BindingEntry } from "../types";
import { resolveTargetUri } from "./common";

export async function addBinding(
  uri: vscode.Uri | undefined,
  configuration: ConfigurationService,
  bindings: BindingService,
  ui: SolutionService,
): Promise<void> {
  const targetUri = await resolveTargetUri(uri);
  if (!targetUri) {
    return;
  }

  const config = await configuration.loadConfiguration();
  const stat = await vscode.workspace.fs.stat(targetUri);
  const kind = stat.type === vscode.FileType.Directory ? "folder" : "file";
  const relative = configuration.getRelativeToWorkspace(targetUri.fsPath);
  const solutionConfig = await ui.promptSolution(config.solutions);

  if (!solutionConfig) {
    vscode.window.showWarningMessage("No solution selected. Binding was not created.");
    return;
  }

  const defaultRemote = buildDefaultRemotePath(relative, solutionConfig.prefix);
  const remotePath = await ui.promptRemotePath(defaultRemote);
  if (!remotePath) {
    return;
  }

  const binding: BindingEntry = {
    relativeLocalPath: targetUri.fsPath,
    remotePath,
    solutionName: solutionConfig.name,
    kind,
  };

  await bindings.addOrUpdateBinding(binding);
  vscode.window.showInformationMessage(
    `Bound ${relative || targetUri.fsPath} to ${remotePath} (${solutionConfig.name}).`,
  );
}

function buildDefaultRemotePath(relativePath: string, defaultPrefix?: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!defaultPrefix) {
    return normalized;
  }

  const prefix = defaultPrefix.replace(/[\\/]+$/, "");
  if (!prefix) {
    return normalized;
  }

  if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
    return normalized;
  }

  return `${prefix}/${normalized}`;
}
