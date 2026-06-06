import * as path from "path";
import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { PcfDeployedControlNode } from "../pcfExplorer";

export async function togglePcfSolutionFilter(ctx: CommandContext): Promise<void> {
  await ctx.pcf.explorer.toggleSolutionFilter();
}

export async function setPcfSolutionFilter(ctx: CommandContext, enabled: boolean): Promise<void> {
  await ctx.pcf.explorer.setSolutionFilter(enabled);
}

export async function setPcfWorkspaceFolderFilter(ctx: CommandContext): Promise<void> {
  const folders = ctx.core.files.workspaceFolders;
  if (folders.length <= 1) {
    await ctx.core.notifications.info("Only one workspace folder is open.");
    await ctx.pcf.explorer.setWorkspaceFolderFilter(undefined);
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
      ...folders.map((folderPath) => ({
        label: path.basename(folderPath),
        description: folderPath,
        rootUri: folderPath,
      })),
    ],
    { placeHolder: "Filter PCF controls by workspace folder" },
  );
  if (!pick) {
    return;
  }

  await ctx.pcf.explorer.setWorkspaceFolderFilter(pick.rootUri);
}

export async function updatePcfFromLocal(
  ctx: CommandContext,
  node?: PcfDeployedControlNode,
): Promise<void> {
  if (!(node instanceof PcfDeployedControlNode) || !node.control.workspaceMatch) {
    await ctx.core.notifications.warning(
      "Select a deployed PCF control that matches the workspace.",
    );
    return;
  }

  const pac = await ctx.pcf.pacCli.detect();
  if (!pac.available) {
    const action = await ctx.core.notifications.askError(
      `Power Platform CLI is required for PCF commands: ${pac.error ?? "pac not found"}.`,
      ["Install pac CLI"],
    );
    if (action === "Install pac CLI") {
      await ctx.core.workbench.openExternal(
        "https://learn.microsoft.com/power-platform/developer/cli/introduction",
      );
    }
    return;
  }

  const project = node.control.workspaceMatch;
  const publisherPrefix = await ctx.pcf.pushService.resolvePublisherPrefix(project);
  if (!publisherPrefix) {
    return;
  }

  await ctx.core.lastSelection.setLastEnvironment(node.env.name);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Pushing ${project.fullName} to ${node.env.name}`,
      cancellable: true,
    },
    async (_progress, token) => {
      const canContinue = await ctx.pcf.pushService.warnForAuthMismatch(node.env, token);
      if (!canContinue) {
        return;
      }

      const ok = await ctx.pcf.pushService.push(project, node.env, publisherPrefix, token);
      if (ok) {
        await ctx.pcf.projectLocator.refresh();
        ctx.pcf.explorer.refresh();
      }
    },
  );
}

export async function copyPcfDeployedControlId(
  ctx: CommandContext,
  node?: PcfDeployedControlNode,
): Promise<void> {
  if (!(node instanceof PcfDeployedControlNode)) {
    await ctx.core.notifications.warning("Select a deployed PCF control first.");
    return;
  }

  await ctx.core.clipboard.writeText(node.control.customControlId);
  await ctx.core.notifications.info(`Copied PCF control ID for ${node.control.name}.`);
}

export async function syncPcfManifestVersionFromEnvironment(
  ctx: CommandContext,
  node?: PcfDeployedControlNode,
): Promise<void> {
  if (!(node instanceof PcfDeployedControlNode) || !node.control.workspaceMatch) {
    await ctx.core.notifications.warning(
      "Select a deployed PCF control that matches the workspace.",
    );
    return;
  }

  if (!node.control.version) {
    await ctx.core.notifications.warning("The deployed PCF control has no version to sync.");
    return;
  }

  const project = node.control.workspaceMatch;
  const content = Buffer.from(await ctx.core.files.readFile(project.manifestUri)).toString("utf8");
  const updated = updateControlVersionInManifest(content, node.control.version);
  if (updated === content) {
    await ctx.core.notifications.info(
      `ControlManifest.Input.xml already uses version ${node.control.version}.`,
    );
    return;
  }

  await ctx.core.files.writeFile(project.manifestUri, Buffer.from(updated, "utf8"));
  await ctx.pcf.projectLocator.refresh();
  ctx.pcf.explorer.refresh();
  await ctx.core.notifications.info(
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
