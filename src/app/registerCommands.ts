import * as vscode from "vscode";
import { openInCrm } from "../features/webResources/commands/openCommands";
import {
  openResourceMenu,
  publishLastResource,
  publishResource,
} from "../features/webResources/commands/publishCommands";
import { addBinding } from "../features/webResources/commands/bindingCommands";
import { editConfiguration } from "../features/config/commands/configCommands";
import {
  setEnvironmentCredentials,
  signInInteractive,
  signOut,
} from "../features/auth/commands/authCommands";
import {
  generatePublicKeyToken,
  registerPluginAssembly,
  updatePluginAssembly,
} from "../features/plugins/commands/pluginCommands";
import {
  createPluginImage,
  createPluginStep,
  deletePluginImage,
  deletePluginStep,
  disablePluginStep,
  editPluginImage,
  editPluginStep,
  enablePluginStep,
} from "../features/plugins/commands/pluginStepCommands";
import { deletePluginType } from "../features/plugins/commands/pluginTypeCommands";
import { CommandContext } from "./commandContext";

export function registerCommands(ctx: CommandContext): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.commands.registerCommand("dynamics365Tools.openResourceMenu", (uri?: vscode.Uri) =>
      openResourceMenu(ctx, uri),
    ),
    vscode.commands.registerCommand("dynamics365Tools.openInCrm", (uri?: vscode.Uri) =>
      openInCrm(ctx, uri),
    ),
    vscode.commands.registerCommand("dynamics365Tools.publishResource", (uri?: vscode.Uri) =>
      publishResource(ctx, uri),
    ),
    vscode.commands.registerCommand("dynamics365Tools.publishLastResource", () =>
      publishLastResource(ctx),
    ),
    vscode.commands.registerCommand("dynamics365Tools.configureEnvironments", () =>
      editConfiguration(ctx),
    ),
    vscode.commands.registerCommand("dynamics365Tools.bindResource", (uri?: vscode.Uri) =>
      addBinding(ctx, uri),
    ),
    vscode.commands.registerCommand("dynamics365Tools.setEnvironmentCredentials", () =>
      setEnvironmentCredentials(ctx),
    ),
    vscode.commands.registerCommand("dynamics365Tools.signInInteractive", () =>
      signInInteractive(ctx),
    ),
    vscode.commands.registerCommand("dynamics365Tools.signOut", () => signOut(ctx)),
    vscode.commands.registerCommand("dynamics365Tools.plugins.registerAssembly", () =>
      registerPluginAssembly(ctx),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.updateAssembly", (node) =>
      updatePluginAssembly(ctx, node),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.deletePluginType", (node) =>
      deletePluginType(ctx, node),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.refreshExplorer", () =>
      ctx.pluginExplorer.refresh(),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.toggleSolutionFilter", () =>
      ctx.pluginExplorer.toggleSolutionFilter(),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.enableSolutionFilter", () =>
      ctx.pluginExplorer.setSolutionFilter(true),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.disableSolutionFilter", () =>
      ctx.pluginExplorer.setSolutionFilter(false),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.generatePublicKeyToken", () =>
      generatePublicKeyToken(ctx),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.createStep", (node) =>
      createPluginStep(ctx, node),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.editStep", (node) =>
      editPluginStep(ctx, node),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.enableStep", (node) =>
      enablePluginStep(ctx, node),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.disableStep", (node) =>
      disablePluginStep(ctx, node),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.deleteStep", (node) =>
      deletePluginStep(ctx, node),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.createImage", (node) =>
      createPluginImage(ctx, node),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.editImage", (node) =>
      editPluginImage(ctx, node),
    ),
    vscode.commands.registerCommand("dynamics365Tools.plugins.deleteImage", (node) =>
      deletePluginImage(ctx, node),
    ),
    vscode.window.registerTreeDataProvider("dynamics365Tools.pluginExplorer", ctx.pluginExplorer),
    ctx.statusBar,
  );

  return disposables;
}
