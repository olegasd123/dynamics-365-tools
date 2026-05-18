import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { PcfDeployedControlNode } from "../pcfExplorer";

export async function togglePcfSolutionFilter(ctx: CommandContext): Promise<void> {
  await ctx.pcfExplorer.toggleSolutionFilter();
}

export async function setPcfSolutionFilter(ctx: CommandContext, enabled: boolean): Promise<void> {
  await ctx.pcfExplorer.setSolutionFilter(enabled);
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
