import * as vscode from "vscode";
import { openInCrm } from "@features/webResources/commands/openCommands";
import {
  openResourceMenu,
  publishLastResource,
  publishResource,
} from "@features/webResources/commands/publishCommands";
import { addBinding } from "@features/webResources/commands/bindingCommands";
import {
  addEnvironment,
  addSolution,
  editConfiguration,
} from "@features/config/commands/configCommands";
import {
  setEnvironmentCredentials,
  signInInteractive,
  signOut,
} from "@features/auth/commands/authCommands";
import {
  generatePublicKeyToken,
  registerPluginAssembly,
  publishLastPluginAssembly,
  updatePluginAssembly,
} from "@features/plugins/commands/pluginCommands";
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
} from "@features/plugins/commands/pluginStepCommands";
import { deletePluginType } from "@features/plugins/commands/pluginTypeCommands";
import {
  addCustomRibbonButton,
  hideAndStubOobRibbonButtons,
  hideOobRibbonButton,
  reorderOobRibbonButtons,
} from "@features/ribbons/commands/ribbonButtonCommands";
import {
  addRibbonCommandDefinition,
  addRibbonCommandAction,
  overrideOobRibbonCommand,
} from "@features/ribbons/commands/ribbonCommandDefinitionCommands";
import {
  addRibbonLocLabel,
  addRibbonLocLabelTitle,
} from "@features/ribbons/commands/ribbonLabelCommands";
import {
  addRibbonRuleChildStep,
  deleteRibbonNode,
  editRibbonNode,
  moveRibbonNodeDown,
  moveRibbonNodeUp,
} from "@features/ribbons/commands/ribbonNodeCommands";
import { previewRibbon } from "@features/ribbons/commands/ribbonPreviewCommands";
import {
  addRibbonCommandDisplayRuleRef,
  addRibbonCommandEnableRuleRef,
  addRibbonDisplayRule,
  addRibbonEnableRule,
} from "@features/ribbons/commands/ribbonRuleCommands";
import {
  cleanupGeneratedRibbonSolutions,
  goToRibbonItem,
  openRibbonFile,
  openRibbonSolutionLocation,
  openRibbonsFromSolution,
  publishRibbonToEnvironment,
  pullRibbonsFromEnvironment,
  redoRibbonEdit,
  refreshRibbonExplorer,
  removeRibbonSolutionSource,
  saveRibbonSolutionZip,
  saveRibbonSource,
  undoRibbonEdit,
} from "@features/ribbons/commands/ribbonSourceCommands";
import {
  buildPcfControl,
  newPcfControl,
  pushPcfControl,
  refreshPcfExplorer,
  stopPcfWatch,
  watchPcfControl,
} from "@features/pcf/commands/pcfWorkspaceCommands";
import {
  copyPcfDeployedControlId,
  setPcfWorkspaceFolderFilter,
  syncPcfManifestVersionFromEnvironment,
  setPcfSolutionFilter,
  togglePcfSolutionFilter,
  updatePcfFromLocal,
} from "@features/pcf/commands/pcfExplorerCommands";
import {
  deployLastPcfSolution,
  packageManagedPcfControl,
  packageUnmanagedPcfControl,
} from "@features/pcf/commands/pcfReleaseCommands";
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
    register("dynamics365Tools.plugins.refreshExplorer", () => ctx.plugins.explorer.refresh()),
    register("dynamics365Tools.plugins.toggleSolutionFilter", () =>
      ctx.plugins.explorer.toggleSolutionFilter(),
    ),
    register("dynamics365Tools.plugins.enableSolutionFilter", () =>
      ctx.plugins.explorer.setSolutionFilter(true),
    ),
    register("dynamics365Tools.plugins.disableSolutionFilter", () =>
      ctx.plugins.explorer.setSolutionFilter(false),
    ),
    register("dynamics365Tools.plugins.generatePublicKeyToken", () => generatePublicKeyToken(ctx)),
    register("dynamics365Tools.ribbons.refreshExplorer", () => refreshRibbonExplorer(ctx), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.ribbons.save", (node) => saveRibbonSource(ctx, node), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.ribbons.undo", () => undoRibbonEdit(ctx), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.ribbons.redo", () => redoRibbonEdit(ctx), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.ribbons.openFile", (node) => openRibbonFile(ctx, node), {
      validateConfiguration: false,
    }),
    register(
      "dynamics365Tools.ribbons.openSolutionLocation",
      (node) => openRibbonSolutionLocation(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register("dynamics365Tools.ribbons.openSolutionZip", () => openRibbonsFromSolution(ctx), {
      validateConfiguration: false,
    }),
    register(
      "dynamics365Tools.ribbons.removeSolutionSource",
      (node) => removeRibbonSolutionSource(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.ribbons.saveSolutionZip",
      (node) => saveRibbonSolutionZip(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.ribbons.publishToEnvironment",
      (node) => publishRibbonToEnvironment(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.ribbons.pullFromEnvironment",
      (node) => pullRibbonsFromEnvironment(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register("dynamics365Tools.ribbons.cleanupGeneratedSolutions", () =>
      cleanupGeneratedRibbonSolutions(ctx),
    ),
    register(
      "dynamics365Tools.ribbons.addCustomButton",
      (node) => addCustomRibbonButton(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.ribbons.addHideOobButton",
      (node) => hideOobRibbonButton(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register("dynamics365Tools.ribbons.hideOobButton", (node) => hideOobRibbonButton(ctx, node), {
      validateConfiguration: false,
    }),
    register(
      "dynamics365Tools.ribbons.hideAndStubOobButtons",
      (node) => hideAndStubOobRibbonButtons(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.ribbons.reorderOobButtons",
      (node) => reorderOobRibbonButtons(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.ribbons.addCommandDefinition",
      (node) => addRibbonCommandDefinition(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.ribbons.overrideOobCommand",
      (node) => overrideOobRibbonCommand(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.ribbons.addCommandAction",
      (node) => addRibbonCommandAction(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.ribbons.addCommandEnableRuleRef",
      (node) => addRibbonCommandEnableRuleRef(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register(
      "dynamics365Tools.ribbons.addCommandDisplayRuleRef",
      (node) => addRibbonCommandDisplayRuleRef(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register("dynamics365Tools.ribbons.addEnableRule", (node) => addRibbonEnableRule(ctx, node), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.ribbons.addDisplayRule", (node) => addRibbonDisplayRule(ctx, node), {
      validateConfiguration: false,
    }),
    register(
      "dynamics365Tools.ribbons.addRuleChildStep",
      (node) => addRibbonRuleChildStep(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register("dynamics365Tools.ribbons.addLocLabel", (node) => addRibbonLocLabel(ctx, node), {
      validateConfiguration: false,
    }),
    register(
      "dynamics365Tools.ribbons.addLocLabelTitle",
      (node) => addRibbonLocLabelTitle(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    register("dynamics365Tools.ribbons.moveUp", (node) => moveRibbonNodeUp(ctx, node), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.ribbons.moveDown", (node) => moveRibbonNodeDown(ctx, node), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.ribbons.deleteNode", (node) => deleteRibbonNode(ctx, node), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.ribbons.editNode", (node) => editRibbonNode(ctx, node), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.ribbons.preview", (node) => previewRibbon(ctx, node), {
      validateConfiguration: false,
    }),
    register("dynamics365Tools.plugins.createStep", (node) => createPluginStep(ctx, node)),
    register("dynamics365Tools.plugins.editStep", (node) => editPluginStep(ctx, node)),
    register("dynamics365Tools.plugins.enableStep", (node) => enablePluginStep(ctx, node)),
    register("dynamics365Tools.plugins.disableStep", (node) => disablePluginStep(ctx, node)),
    register("dynamics365Tools.plugins.deleteStep", (node) => deletePluginStep(ctx, node)),
    register("dynamics365Tools.plugins.createImage", (node) => createPluginImage(ctx, node)),
    register("dynamics365Tools.plugins.copyStepDescription", (node) =>
      copyStepDescription(ctx, node),
    ),
    register("dynamics365Tools.plugins.copyImageDescription", (node) =>
      copyImageDescription(ctx, node),
    ),
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
      (node) => copyPcfDeployedControlId(ctx, node),
      {
        validateConfiguration: false,
      },
    ),
    registerLazyTreeDataProvider("dynamics365Tools.pluginExplorer", () => ctx.plugins.explorer),
    registerLazyTreeDataProvider("dynamics365Tools.pcfExplorer", () => ctx.pcf.explorer),
    createRibbonTreeView(ctx),
  );

  return disposables;
}

function createRibbonTreeView(ctx: CommandContext): vscode.Disposable {
  const treeDataProvider = new LazyTreeDataProvider(() => ctx.ribbon.explorer);
  const treeView = vscode.window.createTreeView("dynamics365Tools.ribbonExplorer", {
    treeDataProvider,
  });

  const selectionSubscription = treeView.onDidChangeSelection((event) => {
    const [node] = event.selection;
    if (node) {
      ctx.ribbon.formPanel.show(node);
    }
  });

  const goToSubscription = vscode.commands.registerCommand(
    "dynamics365Tools.ribbons.goToItem",
    () =>
      runCommandWithHealthCheck(
        ctx,
        "dynamics365Tools.ribbons.goToItem",
        () => goToRibbonItem(ctx, treeView),
        { validateConfiguration: false },
      ),
  );

  return vscode.Disposable.from(
    treeView,
    selectionSubscription,
    goToSubscription,
    treeDataProvider,
  );
}

function registerLazyTreeDataProvider<T>(
  viewId: string,
  loadProvider: () => vscode.TreeDataProvider<T>,
): vscode.Disposable {
  const treeDataProvider = new LazyTreeDataProvider(loadProvider);
  return vscode.Disposable.from(
    vscode.window.registerTreeDataProvider(viewId, treeDataProvider),
    treeDataProvider,
  );
}

class LazyTreeDataProvider<T> implements vscode.TreeDataProvider<T>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    T | T[] | null | undefined | void
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private providerPromise?: Promise<vscode.TreeDataProvider<T>>;
  private eventSubscription?: vscode.Disposable;

  constructor(private readonly loadProvider: () => vscode.TreeDataProvider<T>) {}

  async getTreeItem(element: T): Promise<vscode.TreeItem> {
    const provider = await this.getProvider();
    return provider.getTreeItem(element);
  }

  async getChildren(element?: T): Promise<T[]> {
    const provider = await this.getProvider();
    return (await provider.getChildren?.(element)) ?? [];
  }

  async getParent(element: T): Promise<T | undefined> {
    const provider = await this.getProvider();
    const parent = await provider.getParent?.(element);
    return parent ?? undefined;
  }

  dispose(): void {
    this.eventSubscription?.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  private async getProvider(): Promise<vscode.TreeDataProvider<T>> {
    if (!this.providerPromise) {
      this.providerPromise = Promise.resolve(this.loadProvider()).then((provider) => {
        this.eventSubscription = provider.onDidChangeTreeData?.((event) => {
          this.onDidChangeTreeDataEmitter.fire(event);
        });
        return provider;
      });
    }
    return this.providerPromise;
  }
}
