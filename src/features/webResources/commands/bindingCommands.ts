import * as vscode from "vscode";
import * as path from "path";
import { CommandContext } from "../../../app/commandContext";
import type { OutputPort } from "../../../app/ports/output";
import { WorkspaceFileType } from "../../../app/ports/files";
import { BindingEntry, Dynamics365Configuration } from "../../config/domain/models";
import { pickDataverseClient, resolveTargetUri } from "../../../app/commandUtils";
import type { DataverseClient } from "../../dataverse/dataverseClient";
import { buildSupportedSet, collectSupportedFiles } from "../core/webResourceHelpers";
import { compareFolderBindingResources, normalizeRemotePath } from "../folderBindingDiff";

export async function addBinding(ctx: CommandContext, uri: vscode.Uri | undefined): Promise<void> {
  const { configuration, ui, notifications, files, workbench } = ctx.core;
  const { bindings } = ctx.webResource;
  const targetUri = await resolveTargetUri(notifications, uri, workbench.activeFilePath);
  if (!targetUri) {
    return;
  }

  const config = await configuration.loadConfiguration();
  const stat = await files.stat(targetUri.fsPath);
  const kind = stat.type === WorkspaceFileType.Directory ? "folder" : "file";
  const relative = configuration.getRelativeToWorkspace(targetUri.fsPath);
  const solutionConfig = await ui.promptSolution(config.solutions);

  if (!solutionConfig) {
    await notifications.warning("No solution selected. Binding was not created.");
    return;
  }

  const defaultRemote = buildDefaultRemotePath(relative, solutionConfig.prefix);
  const remotePath = await ui.promptRemotePath(defaultRemote);
  if (!remotePath) {
    return;
  }

  if (kind === "folder") {
    const canCreate = await confirmFolderBinding(ctx, targetUri, remotePath, config);
    if (!canCreate) {
      return;
    }
  }

  const binding: BindingEntry = {
    relativeLocalPath: targetUri.fsPath,
    remotePath,
    solutionName: solutionConfig.name,
    kind,
  };

  await bindings.addOrUpdateBinding(binding);
  await notifications.info(
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

async function confirmFolderBinding(
  ctx: CommandContext,
  folderUri: vscode.Uri,
  remotePath: string,
  config: Dynamics365Configuration,
): Promise<boolean> {
  const supportedFiles = await collectSupportedFiles(
    folderUri,
    buildSupportedSet(),
    ctx.core.files,
  );
  if (!supportedFiles.length) {
    return true;
  }

  const target = await pickDataverseClient(ctx, {
    config,
    placeHolder: "Select environment to compare local and CRM resources",
  });
  if (!target) {
    return false;
  }

  const localRemotePaths = supportedFiles.map((file) => {
    const relative = path.relative(folderUri.fsPath, file.fsPath);
    return joinRemote(remotePath, relative);
  });

  try {
    const client = target.client;
    const crmResources = await listWebResourceNamesByPrefix(client, remotePath);
    const summary = compareFolderBindingResources(localRemotePaths, crmResources);
    if (!summary.hasDifferences) {
      return true;
    }

    logBindingDiff(
      ctx.core.output,
      target.env.name,
      folderUri.fsPath,
      remotePath,
      summary.onlyLocal,
      summary.onlyCrm,
    );
    const decision = await ctx.core.notifications.askWarning(
      `Binding check for ${target.env.name}: local ${summary.localCount}, CRM ${summary.crmCount}, match ${summary.matchCount}, only local ${summary.onlyLocalCount}, only CRM ${summary.onlyCrmCount}. Continue?`,
      ["Create Binding", "Cancel"],
    );
    return decision === "Create Binding";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const decision = await ctx.core.notifications.askWarning(
      `Could not compare local files with CRM resources: ${message}. Continue creating binding?`,
      ["Create Binding", "Cancel"],
    );
    return decision === "Create Binding";
  }
}

function joinRemote(base: string, relative: string): string {
  const normalizedBase = normalizeRemotePath(base);
  const normalizedRelative = relative.replace(/\\/g, "/");
  return normalizedRelative ? `${normalizedBase}/${normalizedRelative}` : normalizedBase;
}

async function listWebResourceNamesByPrefix(
  client: DataverseClient,
  remotePath: string,
): Promise<string[]> {
  const normalized = normalizeRemotePath(remotePath);
  const escaped = normalized.replace(/'/g, "''");
  const filter = encodeURIComponent(`(name eq '${escaped}' or startswith(name,'${escaped}/'))`);
  let url = `/webresourceset?$select=name&$filter=${filter}&$top=5000`;
  const resources = new Set<string>();

  while (url) {
    const response = await client.get<{
      value?: Array<{ name?: string }>;
      "@odata.nextLink"?: string;
    }>(url);
    for (const item of response.value ?? []) {
      if (item.name?.trim()) {
        resources.add(normalizeRemotePath(item.name));
      }
    }
    url = response["@odata.nextLink"] ?? "";
  }

  return [...resources];
}

function logBindingDiff(
  output: OutputPort,
  environmentName: string,
  localFolderPath: string,
  remotePath: string,
  onlyLocal: string[],
  onlyCrm: string[],
): void {
  const bindingOutput = output.createChannel("Dynamics 365 Tools Binding");
  bindingOutput.appendLine("────────────────────────────────────────────────────────────────────");
  bindingOutput.appendLine(`[${new Date().toISOString()}] Folder binding diff`);
  bindingOutput.appendLine(`Environment: ${environmentName}`);
  bindingOutput.appendLine(`Local folder: ${localFolderPath}`);
  bindingOutput.appendLine(`Remote path: ${normalizeRemotePath(remotePath)}`);

  if (onlyLocal.length) {
    bindingOutput.appendLine("Only in local:");
    for (const item of onlyLocal) {
      bindingOutput.appendLine(`  - ${item}`);
    }
  }

  if (onlyCrm.length) {
    bindingOutput.appendLine("Only in CRM:");
    for (const item of onlyCrm) {
      bindingOutput.appendLine(`  - ${item}`);
    }
  }

  bindingOutput.show(true);
}
