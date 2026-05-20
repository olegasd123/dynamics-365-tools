import * as fs from "fs/promises";
import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { PcfDeployedControlNode } from "../pcfExplorer";

export async function togglePcfSolutionFilter(ctx: CommandContext): Promise<void> {
  await ctx.pcfExplorer.toggleSolutionFilter();
}

export async function setPcfSolutionFilter(ctx: CommandContext, enabled: boolean): Promise<void> {
  await ctx.pcfExplorer.setSolutionFilter(enabled);
}

export async function setPcfWorkspaceFolderFilter(ctx: CommandContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) {
    vscode.window.showInformationMessage("Only one workspace folder is open.");
    await ctx.pcfExplorer.setWorkspaceFolderFilter(undefined);
    return;
  }

  const all = {
    label: "All workspace folders",
    description: "Show every PCF control",
    rootUri: undefined,
  };
  const pick = await vscode.window.showQuickPick(
    [
      all,
      ...folders.map((folder) => ({
        label: folder.name,
        description: folder.uri.fsPath,
        rootUri: folder.uri.fsPath,
      })),
    ],
    { placeHolder: "Filter PCF controls by workspace folder" },
  );
  if (!pick) {
    return;
  }

  await ctx.pcfExplorer.setWorkspaceFolderFilter(pick.rootUri);
}

export async function updatePcfFromLocal(
  ctx: CommandContext,
  node?: PcfDeployedControlNode,
): Promise<void> {
  if (!(node instanceof PcfDeployedControlNode) || !node.control.workspaceMatch) {
    vscode.window.showWarningMessage("Select a deployed PCF control that matches the workspace.");
    return;
  }

  const pac = await ctx.pacCli.detect();
  if (!pac.available) {
    const action = await vscode.window.showErrorMessage(
      `Power Platform CLI is required for PCF commands: ${pac.error ?? "pac not found"}.`,
      "Install pac CLI",
    );
    if (action === "Install pac CLI") {
      await vscode.env.openExternal(
        vscode.Uri.parse("https://learn.microsoft.com/power-platform/developer/cli/introduction"),
      );
    }
    return;
  }

  const project = node.control.workspaceMatch;
  const publisherPrefix = await ctx.pcfPushService.resolvePublisherPrefix(project);
  if (!publisherPrefix) {
    return;
  }

  await ctx.lastSelection.setLastEnvironment(node.env.name);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Pushing ${project.fullName} to ${node.env.name}`,
      cancellable: true,
    },
    async (_progress, token) => {
      const canContinue = await ctx.pcfPushService.warnForAuthMismatch(node.env, token);
      if (!canContinue) {
        return;
      }

      const ok = await ctx.pcfPushService.push(project, node.env, publisherPrefix, token);
      if (ok) {
        await ctx.pcfProjectLocator.refresh();
        ctx.pcfExplorer.refresh();
      }
    },
  );
}

export async function copyPcfDeployedControlId(node?: PcfDeployedControlNode): Promise<void> {
  if (!(node instanceof PcfDeployedControlNode)) {
    vscode.window.showWarningMessage("Select a deployed PCF control first.");
    return;
  }

  await vscode.env.clipboard.writeText(node.control.customControlId);
  vscode.window.showInformationMessage(`Copied PCF control ID for ${node.control.name}.`);
}

export async function syncPcfManifestVersionFromEnvironment(
  ctx: CommandContext,
  node?: PcfDeployedControlNode,
): Promise<void> {
  if (!(node instanceof PcfDeployedControlNode) || !node.control.workspaceMatch) {
    vscode.window.showWarningMessage("Select a deployed PCF control that matches the workspace.");
    return;
  }

  if (!node.control.version) {
    vscode.window.showWarningMessage("The deployed PCF control has no version to sync.");
    return;
  }

  const project = node.control.workspaceMatch;
  const content = await fs.readFile(project.manifestUri, "utf8");
  const updated = updateControlVersionInManifest(content, node.control.version);
  if (updated === content) {
    vscode.window.showInformationMessage(
      `ControlManifest.Input.xml already uses version ${node.control.version}.`,
    );
    return;
  }

  await fs.writeFile(project.manifestUri, updated, "utf8");
  await ctx.pcfProjectLocator.refresh();
  ctx.pcfExplorer.refresh();
  vscode.window.showInformationMessage(
    `Updated ${project.fullName} manifest version to ${node.control.version}.`,
  );
}

export function updateControlVersionInManifest(content: string, version: string): string {
  const controlTag = content.match(/<control\b[^>]*>/i);
  if (!controlTag) {
    throw new Error("ControlManifest.Input.xml has no control node.");
  }

  const tag = controlTag[0];
  const replacement = /\bversion\s*=\s*(["'])[^"']*\1/i.test(tag)
    ? tag.replace(/\bversion\s*=\s*(["'])[^"']*\1/i, `version="${escapeXmlAttribute(version)}"`)
    : tag.replace(/\/?>$/, ` version="${escapeXmlAttribute(version)}"$&`);

  return `${content.slice(0, controlTag.index)}${replacement}${content.slice(
    (controlTag.index ?? 0) + tag.length,
  )}`;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
