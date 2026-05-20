import * as vscode from "vscode";
import { openInCrm } from "../features/webResources/commands/openCommands";
import {
  openResourceMenu,
  publishLastResource,
  publishResource,
} from "../features/webResources/commands/publishCommands";
import { addBinding } from "../features/webResources/commands/bindingCommands";
import {
  addEnvironment,
  addSolution,
  editConfiguration,
} from "../features/config/commands/configCommands";
import {
  setEnvironmentCredentials,
  signInInteractive,
  signOut,
} from "../features/auth/commands/authCommands";
import {
  generatePublicKeyToken,
  registerPluginAssembly,
  publishLastPluginAssembly,
  updatePluginAssembly,
} from "../features/plugins/commands/pluginCommands";
import {
  createPluginImage,
  createPluginStep,
  copyImageDescription,
  copyStepDescription,
  deletePluginImage,
  deletePluginStep,
  disablePluginStep,
  editPluginImage,
  editPluginStep,
  enablePluginStep,
} from "../features/plugins/commands/pluginStepCommands";
import { deletePluginType } from "../features/plugins/commands/pluginTypeCommands";
import {
  buildPcfControl,
  newPcfControl,
  pushPcfControl,
  refreshPcfExplorer,
  stopPcfWatch,
  watchPcfControl,
} from "../features/pcf/commands/pcfWorkspaceCommands";
import {
  copyPcfDeployedControlId,
  setPcfWorkspaceFolderFilter,
  syncPcfManifestVersionFromEnvironment,
  setPcfSolutionFilter,
  togglePcfSolutionFilter,
  updatePcfFromLocal,
} from "../features/pcf/commands/pcfExplorerCommands";
import {
  deployLastPcfSolution,
  packageManagedPcfControl,
  packageUnmanagedPcfControl,
} from "../features/pcf/commands/pcfReleaseCommands";
import { CommandContext } from "./commandContext";
import { CommandRunOptions, runCommandWithHealthCheck } from "./commandRunner";

export function registerCommands(ctx: CommandContext): vscode.Disposable[] {
  const register = (
    commandId: string,
    handler: (...args: any[]) => Promise<unknown> | unknown,
    options?: CommandRunOptions,
  ): vscode.Disposable =>
    vscode.commands.registerCommand(commandId, (...args: any[]) =>
      runCommandWithHealthCheck(ctx, commandId, () => handler(...args), options),
    );

  const webResourceCommandOptions: CommandRunOptions = {
    validateBindings: true,
  };

  const disposables: vscode.Disposable[] = [];

  disposables.push(
    register(
      "dynamics365Tools.openResourceMenu",
      (uri?: vscode.Uri) => openResourceMenu(ctx, uri),
      webResourceCommandOptions,
    ),
    register(
      "dynamics365Tools.openInCrm",
      (uri?: vscode.Uri) => openInCrm(ctx, uri),
      webResourceCommandOptions,
    ),
    register(
      "dynamics365Tools.publishResource",
      (uri?: vscode.Uri) => publishResource(ctx, uri),
      webResourceCommandOptions,
    ),
    register(
      "dynamics365Tools.publishLastResource",
      () => publishLastResource(ctx),
      webResourceCommandOptions,
    ),
    register("dynamics365Tools.configureEnvironments", () => editConfiguration(ctx)),
    register("dynamics365Tools.addEnvironment", () => addEnvironment(ctx)),
    register("dynamics365Tools.addSolution", () => addSolution(ctx)),
    register(
      "dynamics365Tools.bindResource",
      (uri?: vscode.Uri) => addBinding(ctx, uri),
      webResourceCommandOptions,
    ),
    register("dynamics365Tools.setEnvironmentCredentials", () => setEnvironmentCredentials(ctx)),
    register("dynamics365Tools.signInInteractive", () => signInInteractive(ctx)),
    register("dynamics365Tools.signOut", () => signOut(ctx)),
    register("dynamics365Tools.plugins.registerAssembly", () => registerPluginAssembly(ctx)),
    register("dynamics365Tools.plugins.publishLastAssembly", () => publishLastPluginAssembly(ctx)),
    register("dynamics365Tools.plugins.updateAssembly", (node) => updatePluginAssembly(ctx, node)),
    register("dynamics365Tools.plugins.deletePluginType", (node) => deletePluginType(ctx, node)),
    register("dynamics365Tools.plugins.refreshExplorer", () => ctx.pluginExplorer.refresh()),
    register("dynamics365Tools.plugins.toggleSolutionFilter", () =>
      ctx.pluginExplorer.toggleSolutionFilter(),
    ),
    register("dynamics365Tools.plugins.enableSolutionFilter", () =>
      ctx.pluginExplorer.setSolutionFilter(true),
    ),
    register("dynamics365Tools.plugins.disableSolutionFilter", () =>
      ctx.pluginExplorer.setSolutionFilter(false),
    ),
    register("dynamics365Tools.plugins.generatePublicKeyToken", () => generatePublicKeyToken(ctx)),
    register("dynamics365Tools.plugins.createStep", (node) => createPluginStep(ctx, node)),
    register("dynamics365Tools.plugins.editStep", (node) => editPluginStep(ctx, node)),
    register("dynamics365Tools.plugins.enableStep", (node) => enablePluginStep(ctx, node)),
    register("dynamics365Tools.plugins.disableStep", (node) => disablePluginStep(ctx, node)),
    register("dynamics365Tools.plugins.deleteStep", (node) => deletePluginStep(ctx, node)),
    register("dynamics365Tools.plugins.createImage", (node) => createPluginImage(ctx, node)),
    register("dynamics365Tools.plugins.copyStepDescription", (node) => copyStepDescription(node)),
    register("dynamics365Tools.plugins.copyImageDescription", (node) => copyImageDescription(node)),
    register("dynamics365Tools.plugins.editImage", (node) => editPluginImage(ctx, node)),
    register("dynamics365Tools.plugins.deleteImage", (node) => deletePluginImage(ctx, node)),
    register("dynamics365Tools.pcf.refreshExplorer", () => refreshPcfExplorer(ctx), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.pcf.newControl", () => newPcfControl(ctx), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.pcf.build", (nodeOrUri) => buildPcfControl(ctx, nodeOrUri), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.pcf.watch", (nodeOrUri) => watchPcfControl(ctx, nodeOrUri), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.pcf.push", (nodeOrUri) => pushPcfControl(ctx, nodeOrUri), {
      validateConfiguration: false,
    }),
    register(
      "dynamics365Tools.pcf.packageManaged",
      (nodeOrUri) => packageManagedPcfControl(ctx, nodeOrUri),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.pcf.packageUnmanaged",
      (nodeOrUri) => packageUnmanagedPcfControl(ctx, nodeOrUri),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.pcf.deployLast",
      (nodeOrUri) => deployLastPcfSolution(ctx, nodeOrUri),
      {
        validateConfiguration: false,
      },
    ),
    register("dynamics365Tools.pcf.stopWatch", (nodeOrUri) => stopPcfWatch(ctx, nodeOrUri), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.pcf.toggleSolutionFilter", () => togglePcfSolutionFilter(ctx), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.pcf.enableSolutionFilter", () => setPcfSolutionFilter(ctx, true), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.pcf.disableSolutionFilter", () => setPcfSolutionFilter(ctx, false), {
      validateConfiguration: false,
    }),
    register(
      "dynamics365Tools.pcf.setWorkspaceFolderFilter",
      () => setPcfWorkspaceFolderFilter(ctx),
      {
        validateConfiguration: false,
      },
    ),
    register("dynamics365Tools.pcf.updateFromLocal", (node) => updatePcfFromLocal(ctx, node), {
      validateConfiguration: false,
    }),
    register(
      "dynamics365Tools.pcf.syncManifestVersionFromEnvironment",
      (node) => syncPcfManifestVersionFromEnvironment(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.pcf.copyDeployedControlId",
      (node) => copyPcfDeployedControlId(node),
      {
        validateConfiguration: false,
      },
    ),
    vscode.window.registerTreeDataProvider("dynamics365Tools.pluginExplorer", ctx.pluginExplorer),
    vscode.window.registerTreeDataProvider("dynamics365Tools.pcfExplorer", ctx.pcfExplorer),
    ctx.pcfProjectLocator,
    ctx.pcfBuildService,
    ctx.pcfPushService,
    ctx.pcfDeployService,
    ctx.pcfPackageService,
    ctx.pcfProcessRunner,
    ctx.pcfStatusBar,
    ctx.pcfTelemetry,
    ctx.statusBar,
    ctx.assemblyStatusBar,
  );

  return disposables;
}
