import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { detectTool } from "../pacCli";
import { PcfControlProjectNode } from "../pcfExplorer";
import { resolvePcfProject } from "./pcfWorkspaceCommands";

export async function packageManagedPcfControl(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): Promise<void> {
  await packagePcfControl(ctx, nodeOrUri, true);
}

export async function packageUnmanagedPcfControl(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): Promise<void> {
  await packagePcfControl(ctx, nodeOrUri, false);
}

export async function deployLastPcfSolution(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): Promise<void> {
  const project = await resolvePcfProject(ctx, nodeOrUri);
  if (!project) {
    return;
  }

  const config = await ctx.core.configuration.loadConfiguration();
  const env = await ctx.core.ui.pickEnvironment(
    config.environments,
    ctx.core.lastSelection.getLastEnvironment(),
    { placeHolder: "Select environment for PCF solution deploy" },
  );
  if (!env) {
    return;
  }

  await ctx.core.lastSelection.setLastEnvironment(env.name);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deploying last PCF solution package for ${project.fullName}`,
      cancellable: true,
    },
    async (_progress, token) => {
      const result = await ctx.pcf.deployService.deployLastPackage(project, env, { token });
      if (result) {
        await ctx.pcf.projectLocator.refresh();
        ctx.pcf.explorer.refresh();
      }
    },
  );
}

async function packagePcfControl(
  ctx: CommandContext,
  nodeOrUri: PcfControlProjectNode | vscode.Uri | undefined,
  managed: boolean,
): Promise<void> {
  if (!(await ensureDotnet(ctx))) {
    return;
  }

  const project = await resolvePcfProject(ctx, nodeOrUri);
  if (!project) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Packaging ${managed ? "managed" : "unmanaged"} PCF solution for ${project.fullName}`,
      cancellable: true,
    },
    async (_progress, token) => {
      const result = await ctx.pcf.packageService.packageControl(project, { managed, token });
      if (result) {
        await ctx.pcf.projectLocator.refresh();
        ctx.pcf.explorer.refresh();
      }
    },
  );
}

async function ensureDotnet(ctx: CommandContext): Promise<boolean> {
  const result = await detectTool(ctx.pcf.processRunner, "dotnet", ["--version"]);
  if (result.available) {
    return true;
  }

  await ctx.core.notifications.error(
    `.NET SDK is required to package PCF solutions: ${result.error ?? "dotnet not found"}.`,
  );
  return false;
}
