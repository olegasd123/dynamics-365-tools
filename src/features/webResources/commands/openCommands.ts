import * as vscode from "vscode";
import * as path from "path";
import { CommandContext } from "../../../app/commandContext";
import { ConfigurationService } from "../../config/configurationService";
import { BindingEntry } from "../../../types";
import { resolveTargetUri, pickEnvironmentAndAuth } from "../../../platform/vscode/commandUtils";
import { buildSupportedSet, ensureSupportedResource } from "../core/webResourceHelpers";
import { addBinding } from "./bindingCommands";

export async function openInCrm(ctx: CommandContext, uri: vscode.Uri | undefined): Promise<void> {
  const { configuration, bindings, ui, secrets, auth, lastSelection, webResources, connections } =
    ctx;
  const targetUri = await resolveTargetUri(uri);
  if (!targetUri) {
    return;
  }

  const config = await configuration.loadConfiguration();
  const supportedExtensions = buildSupportedSet();

  if (!(await ensureSupportedResource(targetUri, supportedExtensions))) {
    return;
  }

  const binding = await bindings.getBinding(targetUri);
  if (!binding) {
    const choice = await vscode.window.showInformationMessage(
      "This resource is not bound yet. Add a binding to open it in CRM.",
      "Add Binding",
      "Cancel",
    );
    if (choice === "Add Binding") {
      await addBinding(ctx, targetUri);
    }
    return;
  }

  const stat = await vscode.workspace.fs.stat(targetUri);
  if (stat.type !== vscode.FileType.File) {
    vscode.window.showInformationMessage("Select a file to open its web resource in CRM.");
    return;
  }

  const remotePath = resolveRemotePath(binding, targetUri, configuration);
  if (!remotePath) {
    return;
  }

  const openContext = await pickEnvironmentAndAuth(
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    config,
    undefined,
    { placeHolder: "Select environment to open in Power Apps" },
  );
  if (!openContext) {
    return;
  }

  const env = openContext.env;
  await lastSelection.setLastEnvironment(env.name);

  const connection = await connections.createConnection(env, openContext.auth);
  if (!connection) {
    return;
  }

  const classicUrl = await webResources.buildClassicWebResourceUrl(
    connection,
    binding.solutionName,
    remotePath,
  );
  if (!classicUrl) {
    return;
  }

  const opened = await vscode.env.openExternal(vscode.Uri.parse(classicUrl));
  if (!opened) {
    vscode.window.showErrorMessage(`Could not open web resource in ${env.name}.`);
  }
}

function resolveRemotePath(
  binding: BindingEntry,
  targetUri: vscode.Uri,
  configuration: ConfigurationService,
): string | undefined {
  const bindingRoot = configuration.resolveLocalPath(binding.relativeLocalPath);
  const targetPath = path.normalize(targetUri.fsPath);

  if (binding.kind === "folder") {
    const relative = path.relative(bindingRoot, targetPath);
    if (!relative || relative.startsWith("..")) {
      vscode.window.showErrorMessage("Selected file is outside the bound folder mapping.");
      return undefined;
    }
    return joinRemote(binding.remotePath, relative);
  }

  return binding.remotePath.replace(/\\/g, "/");
}

function joinRemote(base: string, relative: string): string {
  const normalizedBase = base.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedRelative = relative.replace(/\\/g, "/");
  return normalizedRelative ? `${normalizedBase}/${normalizedRelative}` : normalizedBase;
}
