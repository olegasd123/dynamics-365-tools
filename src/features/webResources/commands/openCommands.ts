import * as vscode from "vscode";
import * as path from "path";
import { CommandContext } from "../../../app/commandContext";
import { BindingEntry } from "../../config/domain/models";
import { resolveTargetUri, pickEnvironmentAndAuth } from "../../../platform/vscode/commandUtils";
import { buildSupportedSet, ensureSupportedResource } from "../core/webResourceHelpers";
import { addBinding } from "./bindingCommands";

export async function openInCrm(ctx: CommandContext, uri: vscode.Uri | undefined): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, notifications } = ctx.core;
  const { bindings, urls: webResources } = ctx.webResource;
  const targetUri = await resolveTargetUri(notifications, uri);
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
    const choice = await notifications.askInfo(
      "This resource is not bound yet. Add a binding to open it in CRM.",
      ["Add Binding", "Cancel"],
    );
    if (choice === "Add Binding") {
      await addBinding(ctx, targetUri);
    }
    return;
  }

  const stat = await vscode.workspace.fs.stat(targetUri);
  if (stat.type !== vscode.FileType.File) {
    await notifications.info("Select a file to open its web resource in CRM.");
    return;
  }

  const remotePath = await resolveRemotePath(ctx, binding, targetUri);
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
    notifications,
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
    await notifications.error(`Could not open web resource in ${env.name}.`);
  }
}

async function resolveRemotePath(
  ctx: CommandContext,
  binding: BindingEntry,
  targetUri: vscode.Uri,
): Promise<string | undefined> {
  const bindingRoot = ctx.core.configuration.resolveLocalPath(binding.relativeLocalPath);
  const targetPath = path.normalize(targetUri.fsPath);

  if (binding.kind === "folder") {
    const relative = path.relative(bindingRoot, targetPath);
    if (!relative || relative.startsWith("..")) {
      await ctx.core.notifications.error("Selected file is outside the bound folder mapping.");
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
