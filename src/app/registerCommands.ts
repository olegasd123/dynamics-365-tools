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
    vscode.window.registerTreeDataProvider("dynamics365Tools.pluginExplorer", ctx.pluginExplorer),
    ctx.statusBar,
    ctx.assemblyStatusBar,
  );

  return disposables;
}
