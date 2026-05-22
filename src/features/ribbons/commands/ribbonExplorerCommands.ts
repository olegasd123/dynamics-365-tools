import * as vscode from "vscode";
import * as path from "node:path";
import { CommandContext } from "../../../app/commandContext";
import { pickEnvironmentAndAuth } from "../../../platform/vscode/commandUtils";
import { DEFAULT_SOLUTION_NAME } from "../../../shared/solutions";
import { BindingEntry } from "../../config/domain/models";
import { DataverseClient } from "../../dataverse/dataverseClient";
import { SolutionImportError } from "../../dataverse/solutionImportService";
import {
  RibbonDocumentNode,
  RibbonExplorerNode,
  RibbonItemNode,
  RibbonSectionNode,
  RibbonSourceNode,
  RibbonViewNode,
} from "../ribbonExplorer";
import {
  createCommandDefinitionPatches,
  createCommandActionPatch,
  createCommandActionReplacePatch,
  createCommandRuleRefPatch,
  createCustomButtonReplacePatch,
  createCustomButtonPatches,
  createDeleteNodePatch,
  createDisplayRulePatches,
  createEnableRulePatches,
  createHideActionReplacePatch,
  createHideActionPatches,
  createLocLabelTitleReplacePatch,
  createLocLabelTitlePatch,
  createLocLabelPatches,
  createNodeAttributeValuePatch,
  createRuleStepReplacePatch,
  createSwapNodePatches,
  makeCustomButtonIds,
  makeHideActionId,
  nextHideActionId,
  NewCommandActionInput,
  NewCustomButtonInput,
  NewRuleStepInput,
} from "../ribbonEditPatches";
import {
  CommandAction,
  CommandDefinition,
  CustomAction,
  DisplayRule,
  EnableRule,
  HideAction,
  LocLabel,
  LocLabelTitle,
  RibbonDocument,
  RibbonSource,
  RibbonView,
  RuleStep,
} from "../models";
import {
  findOobRibbonLocation,
  listOobRibbonCommands,
  listOobRibbonLocations,
  OobRibbonCommand,
} from "../oobCatalog";

interface OobCommandPick extends vscode.QuickPickItem {
  command?: OobRibbonCommand;
  manual?: boolean;
}

interface WebResourceLibraryPick extends vscode.QuickPickItem {
  uniqueName: string;
  localPath?: string;
  manual?: boolean;
}

interface SolutionOpenPick extends vscode.QuickPickItem {
  sourceKind: "environment" | "disk";
}

interface DataverseSolutionPick extends vscode.QuickPickItem {
  uniqueName: string;
}

interface RibbonPublishSolutionPick extends vscode.QuickPickItem {
  publishKind: "existing" | "generated";
  uniqueName?: string;
  publisherPrefix?: string;
}

interface PublisherPrefixPick extends vscode.QuickPickItem {
  publisherPrefix: string;
}

interface GeneratedSolutionPick extends vscode.QuickPickItem {
  solutionId: string;
}

export function refreshRibbonExplorer(ctx: CommandContext): void {
  ctx.ribbonExplorer.refresh();
}

export async function openRibbonsFromSolution(ctx: CommandContext): Promise<void> {
  const pick = await vscode.window.showQuickPick<SolutionOpenPick>(
    [
      {
        label: "Download from environment",
        description: "Export an unmanaged solution zip",
        sourceKind: "environment",
      },
      {
        label: "Open zip from disk",
        description: "Use a local solution zip file",
        sourceKind: "disk",
      },
    ],
    { placeHolder: "Open ribbons from solution" },
  );
  if (!pick) {
    return;
  }

  if (pick.sourceKind === "disk") {
    await openRibbonsFromDisk(ctx);
    return;
  }

  await openRibbonsFromEnvironment(ctx);
}

export async function saveRibbonSolutionZip(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const source = await resolveSource(ctx, node);
  if (!source || source.kind !== "zip") {
    vscode.window.showWarningMessage("Select an imported solution zip source first.");
    return;
  }

  if (ctx.ribbonEditorState.isSourceDirty(source.id)) {
    await ctx.ribbonEditorState.saveSource(source.id);
  }

  const defaultUri = source.zip?.originalZipUri
    ? vscode.Uri.file(source.zip.originalZipUri)
    : vscode.Uri.file(path.join(ctx.extensionContext.globalStorageUri.fsPath, source.name));
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { "Solution zip": ["zip"] },
    saveLabel: "Save Solution Zip",
  });
  if (!target) {
    return;
  }

  const savedPath = await ctx.solutionZipService.saveSourceToZip(source, target.fsPath);
  ctx.ribbonExplorer.refresh();
  void vscode.window.showInformationMessage(`Saved solution zip to ${savedPath}.`);
}

export async function saveRibbonSource(
  ctx: CommandContext,
  node?:
    | RibbonSourceNode
    | RibbonDocumentNode
    | RibbonViewNode
    | RibbonSectionNode
    | RibbonItemNode,
): Promise<void> {
  const sourceId = resolveSourceId(node);
  const result = sourceId
    ? await ctx.ribbonEditorState.saveSource(sourceId)
    : await ctx.ribbonEditorState.saveAllSources();
  ctx.ribbonExplorer.refresh();
  const count = result.changedFileUris.length;
  void vscode.window.showInformationMessage(
    count ? `Saved ${count} ribbon file${count === 1 ? "" : "s"}.` : "No ribbon changes to save.",
  );
}

export async function publishRibbonToEnvironment(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const sourceId = resolveSourceId(node);
  const documents = await resolvePublishDocuments(ctx, node);
  if (!documents.length) {
    vscode.window.showWarningMessage("Select a ribbon source or ribbon document first.");
    return;
  }

  if (sourceId && ctx.ribbonEditorState.isSourceDirty(sourceId)) {
    const choice = await vscode.window.showWarningMessage(
      "Save ribbon changes before publishing?",
      { modal: true },
      "Save and Publish",
    );
    if (choice !== "Save and Publish") {
      return;
    }
    await ctx.ribbonEditorState.saveSource(sourceId);
    ctx.ribbonExplorer.refresh();
  }

  const config = await ctx.configuration.loadConfiguration();
  const target = await pickEnvironmentAndAuth(
    ctx.configuration,
    ctx.ui,
    ctx.secrets,
    ctx.auth,
    ctx.lastSelection,
    config,
    undefined,
    { placeHolder: "Select environment for ribbon publish" },
  );
  if (!target) {
    return;
  }

  const connection = await ctx.connections.createConnection(target.env, target.auth);
  if (!connection) {
    return;
  }

  const client = new DataverseClient(connection);
  const solutions = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading unmanaged solutions",
      cancellable: false,
    },
    () => ctx.ribbonPublishService.listUnmanagedSolutions(client),
  );
  const solution = await pickPublishSolution(ctx, client, solutions, documents);
  if (!solution) {
    return;
  }

  if (solution.uniqueName.toLowerCase() === DEFAULT_SOLUTION_NAME.toLowerCase()) {
    const choice = await vscode.window.showWarningMessage(
      "Publishing to the Default solution is allowed but not recommended.",
      { modal: true },
      "Publish Anyway",
    );
    if (choice !== "Publish Anyway") {
      return;
    }
  }

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Publishing ribbons to ${target.env.name}`,
        cancellable: true,
      },
      (progress, token) =>
        ctx.ribbonPublishService.publishDocuments(client, documents, solution, {
          token,
          onStatus: (message) => progress.report({ message }),
        }),
    );

    const summary = [
      `${result.entities.length} entit${result.entities.length === 1 ? "y" : "ies"}`,
      result.includesApplicationRibbon ? "application ribbon" : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    void vscode.window.showInformationMessage(
      `Published ribbons to ${target.env.name} (${summary}).`,
    );
  } catch (error) {
    const message = describeRibbonPublishError(error);
    if (error instanceof SolutionImportError && error.log) {
      const action = await vscode.window.showErrorMessage(
        `Ribbon publish failed: ${message}`,
        "Copy Error XML",
      );
      if (action === "Copy Error XML") {
        await vscode.env.clipboard.writeText(error.log);
      }
      return;
    }

    void vscode.window.showErrorMessage(`Ribbon publish failed: ${message}`);
  }
}

export async function cleanupGeneratedRibbonSolutions(ctx: CommandContext): Promise<void> {
  const config = await ctx.configuration.loadConfiguration();
  const target = await pickEnvironmentAndAuth(
    ctx.configuration,
    ctx.ui,
    ctx.secrets,
    ctx.auth,
    ctx.lastSelection,
    config,
    undefined,
    { placeHolder: "Select environment for generated solution cleanup" },
  );
  if (!target) {
    return;
  }

  const connection = await ctx.connections.createConnection(target.env, target.auth);
  if (!connection) {
    return;
  }

  const client = new DataverseClient(connection);
  const generated = await ctx.ribbonPublishService.listGeneratedSolutions(client);
  if (!generated.length) {
    void vscode.window.showInformationMessage("No generated ribbon solutions were found.");
    return;
  }

  const picks = await vscode.window.showQuickPick<GeneratedSolutionPick>(
    generated.map((solution) => ({
      label: solution.uniqueName,
      description: solution.friendlyName,
      solutionId: solution.solutionId,
    })),
    {
      canPickMany: true,
      placeHolder: "Select generated ribbon solutions to delete",
    },
  );
  if (!picks?.length) {
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Delete ${picks.length} generated ribbon solution${picks.length === 1 ? "" : "s"}?`,
    { modal: true },
    "Delete",
  );
  if (choice !== "Delete") {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Deleting generated ribbon solutions",
      cancellable: false,
    },
    async () => {
      for (const pick of picks) {
        await ctx.ribbonPublishService.deleteGeneratedSolution(client, pick.solutionId);
      }
    },
  );
  void vscode.window.showInformationMessage(
    `Deleted ${picks.length} generated ribbon solution${picks.length === 1 ? "" : "s"}.`,
  );
}

export async function openRibbonFile(node?: RibbonDocumentNode | RibbonSourceNode): Promise<void> {
  if (node instanceof RibbonSourceNode && node.source.kind === "flat") {
    const fileUri = node.source.files[0]?.fileUri;
    if (fileUri) {
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(fileUri));
    }
    return;
  }

  if (!(node instanceof RibbonDocumentNode)) {
    vscode.window.showWarningMessage("Select a ribbon document first.");
    return;
  }

  await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(node.document.fileUri));
}

async function openRibbonsFromDisk(ctx: CommandContext): Promise<void> {
  const picks = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { "Solution zip": ["zip"] },
    openLabel: "Open Solution Zip",
  });
  const zipUri = picks?.[0];
  if (!zipUri) {
    return;
  }

  const source = await ctx.solutionZipService.openZipFile(
    zipUri.fsPath,
    ctx.extensionContext.globalStorageUri.fsPath,
  );
  addImportedRibbonSource(ctx, source);
}

async function resolvePublishDocuments(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
): Promise<RibbonDocument[]> {
  if (node instanceof RibbonDocumentNode) {
    return [node.document];
  }

  if (node instanceof RibbonViewNode || node instanceof RibbonSectionNode) {
    return [node.document];
  }

  if (node instanceof RibbonItemNode && node.editTarget) {
    return [node.editTarget.document];
  }

  const source = await resolveSource(ctx, node);
  if (!source) {
    return [];
  }

  return ctx.ribbonEditorState.loadSource(source);
}

async function pickPublishSolution(
  ctx: CommandContext,
  client: DataverseClient,
  solutions: Awaited<ReturnType<CommandContext["ribbonPublishService"]["listUnmanagedSolutions"]>>,
  documents: RibbonDocument[],
): Promise<
  Awaited<ReturnType<CommandContext["ribbonPublishService"]["createGeneratedSolution"]>> | undefined
> {
  const picks: RibbonPublishSolutionPick[] = [
    ...solutions.map((solution) => ({
      label: solution.friendlyName || solution.uniqueName,
      description:
        solution.friendlyName && solution.friendlyName !== solution.uniqueName
          ? solution.uniqueName
          : undefined,
      detail: `Unmanaged solution • Publisher prefix: ${solution.publisherPrefix}`,
      publishKind: "existing" as const,
      uniqueName: solution.uniqueName,
    })),
    {
      label: "Create generated solution",
      description: "Use a temporary d365tools_ribbon_* solution",
      detail: "The solution is left in the environment until cleanup is run.",
      publishKind: "generated",
    },
  ];

  const pick = await vscode.window.showQuickPick<RibbonPublishSolutionPick>(picks, {
    placeHolder: "Select target solution for ribbon publish",
  });
  if (!pick) {
    return undefined;
  }

  if (pick.publishKind === "existing") {
    return solutions.find((solution) => solution.uniqueName === pick.uniqueName);
  }

  const prefix = await pickPublisherPrefix(solutions);
  if (!prefix) {
    return undefined;
  }

  return ctx.ribbonPublishService.createGeneratedSolution(
    client,
    prefix.publisherPrefix,
    describePublishScope(documents),
  );
}

async function pickPublisherPrefix(
  solutions: Awaited<ReturnType<CommandContext["ribbonPublishService"]["listUnmanagedSolutions"]>>,
): Promise<PublisherPrefixPick | undefined> {
  const prefixes = [
    ...new Set(solutions.map((solution) => solution.publisherPrefix).filter(Boolean)),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((publisherPrefix) => ({
      label: publisherPrefix,
      description: "Publisher prefix",
      publisherPrefix,
    }));

  if (!prefixes.length) {
    vscode.window.showErrorMessage("No publisher prefix was found in unmanaged solutions.");
    return undefined;
  }

  return vscode.window.showQuickPick<PublisherPrefixPick>(prefixes, {
    placeHolder: "Select publisher prefix for generated solution",
  });
}

function describePublishScope(documents: RibbonDocument[]): string {
  const entities = documents
    .filter((document) => document.kind === "Entity")
    .map((document) => document.entityLogicalName)
    .filter((name): name is string => Boolean(name?.trim()));
  const hasApplication = documents.some((document) => document.kind === "Application");
  if (entities.length === 1 && !hasApplication) {
    return entities[0];
  }
  if (!entities.length && hasApplication) {
    return "application";
  }
  return "source";
}

function describeRibbonPublishError(error: unknown): string {
  if (error instanceof SolutionImportError && error.errors.length) {
    return error.errors.join("; ");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function openRibbonsFromEnvironment(ctx: CommandContext): Promise<void> {
  const config = await ctx.configuration.loadConfiguration();
  const target = await pickEnvironmentAndAuth(
    ctx.configuration,
    ctx.ui,
    ctx.secrets,
    ctx.auth,
    ctx.lastSelection,
    config,
    undefined,
    { placeHolder: "Select environment for solution export" },
  );
  if (!target) {
    return;
  }

  const connection = await ctx.connections.createConnection(target.env, target.auth);
  if (!connection) {
    return;
  }

  const client = new DataverseClient(connection);
  const solutions = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading unmanaged solutions",
      cancellable: false,
    },
    () => ctx.solutionZipService.listUnmanagedSolutions(client),
  );
  const solutionPick = await vscode.window.showQuickPick<DataverseSolutionPick>(
    solutions.map((solution) => ({
      label: solution.uniqueName,
      description: solution.version,
      detail: solution.friendlyName,
      uniqueName: solution.uniqueName,
    })),
    { placeHolder: "Select unmanaged solution" },
  );
  if (!solutionPick) {
    return;
  }

  const buffer = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Exporting ${solutionPick.uniqueName}`,
      cancellable: false,
    },
    () => ctx.solutionZipService.downloadSolutionZip(client, solutionPick.uniqueName),
  );
  const source = await ctx.solutionZipService.openZipBuffer(buffer, {
    storageRoot: ctx.extensionContext.globalStorageUri.fsPath,
    sourceName: `${solutionPick.uniqueName}.zip`,
  });
  addImportedRibbonSource(ctx, source);
}

function addImportedRibbonSource(ctx: CommandContext, source: RibbonSource): void {
  ctx.ribbonSourceLocator.addImportedSource(source);
  ctx.ribbonExplorer.refresh();
  void vscode.window.showInformationMessage(
    `Opened ${source.name} with ${source.files.length} ribbon file${source.files.length === 1 ? "" : "s"}.`,
  );
}

export function deleteRibbonNode(ctx: CommandContext, node?: RibbonItemNode): void {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    vscode.window.showWarningMessage("Select a ribbon item that can be deleted.");
    return;
  }

  const { document, range } = node.editTarget;
  ctx.ribbonEditorState.queuePatches(document, [createDeleteNodePatch(document.sourceText, range)]);
  ctx.ribbonExplorer.refresh();
}

export async function editRibbonNode(ctx: CommandContext, node?: RibbonItemNode): Promise<void> {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    vscode.window.showWarningMessage("Select a ribbon item that can be edited.");
    return;
  }

  const target = resolveEditableTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("This ribbon item cannot be edited yet.");
    return;
  }

  switch (target.kind) {
    case "CustomAction":
      await editCustomAction(ctx, target.document, target.action);
      return;
    case "HideAction":
      await editHideAction(ctx, target.document, target.action);
      return;
    case "CommandDefinition":
      await editNodeId(
        ctx,
        target.document,
        target.command.range,
        "CommandDefinition id",
        target.command.id,
      );
      return;
    case "EnableRule":
      await editNodeId(ctx, target.document, target.rule.range, "Enable rule id", target.rule.id);
      return;
    case "DisplayRule":
      await editNodeId(ctx, target.document, target.rule.range, "Display rule id", target.rule.id);
      return;
    case "LocLabel":
      await editNodeId(ctx, target.document, target.label.range, "Loc label id", target.label.id);
      return;
    case "CommandAction":
      await editCommandAction(ctx, target.document, target.action);
      return;
    case "RuleStep":
      await editRuleStep(ctx, target.document, target.ruleKind, target.step);
      return;
    case "LocLabelTitle":
      await editLocLabelTitle(ctx, target.document, target.title);
      return;
  }
}

export async function addCustomRibbonButton(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const label = await vscode.window.showInputBox({
    prompt: "Button label",
    placeHolder: "Validate and save",
    validateInput: (value) => (value.trim() ? undefined : "Button label is required."),
  });
  if (!label) {
    return;
  }

  const location = await pickLocation(target.document, target.view);
  if (!location) {
    return;
  }

  const actionKind = await vscode.window.showQuickPick(
    [
      { label: "JavaScript function", description: "Call a workspace web resource" },
      { label: "URL", description: "Open a URL" },
    ],
    { placeHolder: "Button action" },
  );
  if (!actionKind) {
    return;
  }

  const ids = makeCustomButtonIds(target.document, target.view.scope, label);
  const labelLocId = ids.labelLocId ?? `${ids.buttonId}.Label`;
  const action =
    actionKind.label === "URL" ? await promptUrlAction() : await promptJavaScriptAction(ctx);
  if (!action) {
    return;
  }

  const image16x16 = await vscode.window.showInputBox({
    prompt: "Small icon web resource",
    placeHolder: "new_/icons/save16.png",
  });
  const image32x32 = await vscode.window.showInputBox({
    prompt: "Large icon web resource",
    placeHolder: "new_/icons/save32.png",
  });

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createCustomButtonPatches(target.document, {
      ...ids,
      location,
      action,
      sequence: nextCustomActionSequence(target.view),
      labelLocId,
      image16x16: image16x16?.trim() || undefined,
      image32x32: image32x32?.trim() || undefined,
      locLabel: {
        id: labelLocId,
        languageCode: 1033,
        description: label.trim(),
      },
    }),
  );
  ctx.ribbonExplorer.refresh();
}

export async function hideOobRibbonButton(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const command = await pickOobCommand(target.document, target.view);
  if (!command) {
    return;
  }

  const location = await pickLocation(target.document, target.view, command);
  if (!location) {
    return;
  }

  const baseId = makeHideActionId(target.document, target.view.scope, command.id);
  const hideActionId = nextHideActionId(target.document, { hideActionId: baseId });
  ctx.ribbonEditorState.queuePatches(
    target.document,
    createHideActionPatches(target.document, { hideActionId, location }),
  );
  ctx.ribbonExplorer.refresh();
}

export async function addRibbonCommandDefinition(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const id = await vscode.window.showInputBox({
    prompt: "Command definition id",
    placeHolder: `d365tools.${target.document.entityLogicalName ?? "application"}.${target.view.scope}.Command`,
    validateInput: (value) => validateUniqueId(target.document, value, "Command id is required."),
  });
  if (!id) {
    return;
  }

  const action = await promptOptionalCommandAction(ctx);
  if (action === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createCommandDefinitionPatches(target.document, {
      id: id.trim(),
      action: action ?? undefined,
    }),
  );
  ctx.ribbonExplorer.refresh();
}

export async function overrideOobRibbonCommand(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const command = await pickOobCommand(target.document, target.view, {
    placeHolder: "OOB command to override",
    manualDescription: "Use a custom OOB command id",
  });
  if (!command) {
    return;
  }

  const duplicate = validateUniqueId(target.document, command.id, "Command id is required.");
  if (duplicate) {
    vscode.window.showWarningMessage(`Cannot override '${command.id}': ${duplicate}`);
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Override OOB command '${command.id}'? This can replace default Dynamics behavior.`,
    { modal: true },
    "Override",
  );
  if (choice !== "Override") {
    return;
  }

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createCommandDefinitionPatches(target.document, {
      id: command.id,
    }),
  );
  ctx.ribbonExplorer.refresh();
}

export async function addRibbonCommandAction(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveCommandTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a command definition first.");
    return;
  }

  const action = await promptCommandAction(ctx);
  if (!action) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(target.document, [
    createCommandActionPatch(target.document, target.command, action),
  ]);
  ctx.ribbonExplorer.refresh();
}

export async function addRibbonCommandEnableRuleRef(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addRibbonCommandRuleRef(ctx, node, "EnableRule");
}

export async function addRibbonCommandDisplayRuleRef(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addRibbonCommandRuleRef(ctx, node, "DisplayRule");
}

export async function addRibbonEnableRule(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addRibbonRule(ctx, node, "Enable");
}

export async function addRibbonDisplayRule(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addRibbonRule(ctx, node, "Display");
}

export async function addRibbonLocLabel(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const id = await vscode.window.showInputBox({
    prompt: "Loc label id",
    placeHolder: `d365tools.${target.document.entityLogicalName ?? "application"}.${target.view.scope}.Label`,
    validateInput: (value) => validateUniqueId(target.document, value, "Label id is required."),
  });
  if (!id) {
    return;
  }

  const description = await vscode.window.showInputBox({
    prompt: "Text",
    placeHolder: "Validate and save",
    validateInput: (value) => (value.trim() ? undefined : "Text is required."),
  });
  if (!description) {
    return;
  }

  const languageCode = await vscode.window.showInputBox({
    prompt: "Language code",
    value: "1033",
    validateInput: (value) =>
      /^\d+$/.test(value.trim()) ? undefined : "Language code must be a number.",
  });
  if (!languageCode) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createLocLabelPatches(target.document, {
      id: id.trim(),
      languageCode: Number(languageCode.trim()),
      description: description.trim(),
    }),
  );
  ctx.ribbonExplorer.refresh();
}

export async function addRibbonLocLabelTitle(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveLocLabelTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a LocLabel first.");
    return;
  }

  const languageCode = await vscode.window.showInputBox({
    prompt: "Language code",
    value: "1033",
    validateInput: (value) => {
      const code = value.trim();
      if (!/^\d+$/.test(code)) {
        return "Language code must be a number.";
      }

      return target.label.titles.some((title) => title.languageCode === Number(code))
        ? "This LocLabel already has this language."
        : undefined;
    },
  });
  if (languageCode === undefined) {
    return;
  }

  const description = await vscode.window.showInputBox({
    prompt: "Text",
    placeHolder: "Validate and save",
    validateInput: (value) => (value.trim() ? undefined : "Text is required."),
  });
  if (description === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(target.document, [
    createLocLabelTitlePatch(target.document, target.label.range, {
      languageCode: Number(languageCode.trim()),
      description: description.trim(),
    }),
  ]);
  ctx.ribbonExplorer.refresh();
}

export async function moveRibbonNodeUp(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await moveRibbonNode(ctx, node, -1);
}

export async function moveRibbonNodeDown(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await moveRibbonNode(ctx, node, 1);
}

function resolveSourceId(node: unknown): string | undefined {
  if (node instanceof RibbonSourceNode) {
    return node.source.id;
  }

  if (node instanceof RibbonDocumentNode) {
    return node.document.sourceId;
  }

  if (node instanceof RibbonViewNode || node instanceof RibbonSectionNode) {
    return node.document.sourceId;
  }

  if (node instanceof RibbonItemNode) {
    return node.editTarget?.document.sourceId;
  }

  return undefined;
}

async function resolveSource(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
): Promise<RibbonSource | undefined> {
  if (node instanceof RibbonSourceNode) {
    return node.source;
  }

  const sourceId = resolveSourceId(node);
  if (!sourceId) {
    return undefined;
  }

  const sources = await ctx.ribbonSourceLocator.locate(ctx.configuration.workspaceRoot);
  return sources.find((source) => source.id === sourceId);
}

function resolveRibbonTarget(
  node: RibbonExplorerNode | undefined,
): { document: RibbonDocument; view: RibbonView } | undefined {
  if (node instanceof RibbonViewNode) {
    return { document: node.document, view: node.view };
  }

  if (node instanceof RibbonSectionNode) {
    return { document: node.document, view: node.view };
  }

  if (node instanceof RibbonDocumentNode && node.document.kind === "Application") {
    return { document: node.document, view: node.document.views[0] };
  }

  return undefined;
}

function resolveCommandTarget(
  node: RibbonExplorerNode | undefined,
): { document: RibbonDocument; command: CommandDefinition } | undefined {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    return undefined;
  }

  if (!node.contextValue.includes("d365RibbonCommandDefinition")) {
    return undefined;
  }

  for (const view of node.editTarget.document.views) {
    const command = view.commandDefinitions.find(
      (item) =>
        item.range.start === node.editTarget?.range.start &&
        item.range.end === node.editTarget.range.end,
    );
    if (command) {
      return { document: node.editTarget.document, command };
    }
  }

  return undefined;
}

function resolveLocLabelTarget(
  node: RibbonExplorerNode | undefined,
): { document: RibbonDocument; label: LocLabel } | undefined {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    return undefined;
  }

  if (node.contextValue !== "d365RibbonLocLabel") {
    return undefined;
  }

  const target = node.editTarget;
  for (const view of target.document.views) {
    const label = view.locLabels.find((item) => sameRange(item.range, target.range));
    if (label) {
      return { document: target.document, label };
    }
  }

  return undefined;
}

type EditableTarget =
  | { kind: "CustomAction"; document: RibbonDocument; action: CustomAction }
  | { kind: "HideAction"; document: RibbonDocument; action: HideAction }
  | { kind: "CommandDefinition"; document: RibbonDocument; command: CommandDefinition }
  | { kind: "EnableRule"; document: RibbonDocument; rule: EnableRule }
  | { kind: "DisplayRule"; document: RibbonDocument; rule: DisplayRule }
  | { kind: "LocLabel"; document: RibbonDocument; label: LocLabel }
  | { kind: "CommandAction"; document: RibbonDocument; action: CommandAction }
  | {
      kind: "RuleStep";
      document: RibbonDocument;
      ruleKind: "Enable" | "Display";
      step: RuleStep;
    }
  | { kind: "LocLabelTitle"; document: RibbonDocument; title: LocLabelTitle };

type ReorderTarget = {
  document: RibbonDocument;
  ranges: Array<{ start: number; end: number }>;
  index: number;
};

async function moveRibbonNode(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
  direction: -1 | 1,
): Promise<void> {
  const target = resolveReorderTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon item that can be moved.");
    return;
  }

  const nextIndex = target.index + direction;
  if (nextIndex < 0 || nextIndex >= target.ranges.length) {
    vscode.window.showWarningMessage(
      direction < 0 ? "Item is already first." : "Item is already last.",
    );
    return;
  }

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createSwapNodePatches(
      target.document.sourceText,
      target.ranges[target.index],
      target.ranges[nextIndex],
    ),
  );
  ctx.ribbonExplorer.refresh();
}

function resolveReorderTarget(node: RibbonExplorerNode | undefined): ReorderTarget | undefined {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    return undefined;
  }

  const target = node.editTarget;
  for (const view of target.document.views) {
    const customAction = findRangeIndex(view.customActions, target.range);
    if (node.contextValue === "d365RibbonCustomAction" && customAction >= 0) {
      return {
        document: target.document,
        ranges: view.customActions.map((item) => item.range),
        index: customAction,
      };
    }

    const hideAction = findRangeIndex(view.hideActions, target.range);
    if (node.contextValue === "d365RibbonHideAction" && hideAction >= 0) {
      return {
        document: target.document,
        ranges: view.hideActions.map((item) => item.range),
        index: hideAction,
      };
    }

    const commandDefinition = findRangeIndex(view.commandDefinitions, target.range);
    if (node.contextValue === "d365RibbonCommandDefinition" && commandDefinition >= 0) {
      return {
        document: target.document,
        ranges: view.commandDefinitions.map((item) => item.range),
        index: commandDefinition,
      };
    }

    const enableRule = findRangeIndex(view.enableRules, target.range);
    if (node.contextValue === "d365RibbonEnableRule" && enableRule >= 0) {
      return {
        document: target.document,
        ranges: view.enableRules.map((item) => item.range),
        index: enableRule,
      };
    }

    const displayRule = findRangeIndex(view.displayRules, target.range);
    if (node.contextValue === "d365RibbonDisplayRule" && displayRule >= 0) {
      return {
        document: target.document,
        ranges: view.displayRules.map((item) => item.range),
        index: displayRule,
      };
    }

    const locLabel = findRangeIndex(view.locLabels, target.range);
    if (node.contextValue === "d365RibbonLocLabel" && locLabel >= 0) {
      return {
        document: target.document,
        ranges: view.locLabels.map((item) => item.range),
        index: locLabel,
      };
    }

    for (const command of view.commandDefinitions) {
      const action = findRangeIndex(command.actions, target.range);
      if (
        (node.contextValue === "d365RibbonJavaScriptAction" ||
          node.contextValue === "d365RibbonUrlAction") &&
        action >= 0
      ) {
        return {
          document: target.document,
          ranges: command.actions.map((item) => item.range),
          index: action,
        };
      }
    }

    for (const rule of [...view.enableRules, ...view.displayRules]) {
      const step = findRangeIndex(rule.steps, target.range);
      if (node.contextValue.startsWith("d365RibbonRuleStep:") && step >= 0) {
        return {
          document: target.document,
          ranges: rule.steps.map((item) => item.range),
          index: step,
        };
      }
    }

    for (const label of view.locLabels) {
      const title = findRangeIndex(label.titles, target.range);
      if (node.contextValue === "d365RibbonLocLabelTitle" && title >= 0) {
        return {
          document: target.document,
          ranges: label.titles.map((item) => item.range),
          index: title,
        };
      }
    }
  }

  return undefined;
}

function findRangeIndex<T extends { range: { start: number; end: number } }>(
  items: T[],
  range: { start: number; end: number },
): number {
  return items.findIndex((item) => sameRange(item.range, range));
}

function resolveEditableTarget(node: RibbonItemNode): EditableTarget | undefined {
  const target = node.editTarget;
  if (!target) {
    return undefined;
  }

  for (const view of target.document.views) {
    const customAction = view.customActions.find((item) => sameRange(item.range, target.range));
    if (customAction && node.contextValue === "d365RibbonCustomAction") {
      return { kind: "CustomAction", document: target.document, action: customAction };
    }

    const hideAction = view.hideActions.find((item) => sameRange(item.range, target.range));
    if (hideAction) {
      return { kind: "HideAction", document: target.document, action: hideAction };
    }

    for (const command of view.commandDefinitions) {
      if (
        sameRange(command.range, target.range) &&
        node.contextValue === "d365RibbonCommandDefinition"
      ) {
        return { kind: "CommandDefinition", document: target.document, command };
      }

      const action = command.actions.find((item) => sameRange(item.range, target.range));
      if (action && action.kind !== "Unknown") {
        return { kind: "CommandAction", document: target.document, action };
      }
    }

    for (const rule of view.enableRules) {
      if (sameRange(rule.range, target.range) && node.contextValue === "d365RibbonEnableRule") {
        return { kind: "EnableRule", document: target.document, rule };
      }

      const step = rule.steps.find((item) => sameRange(item.range, target.range));
      if (step && step.kind !== "Unknown") {
        return { kind: "RuleStep", document: target.document, ruleKind: "Enable", step };
      }
    }

    for (const rule of view.displayRules) {
      if (sameRange(rule.range, target.range) && node.contextValue === "d365RibbonDisplayRule") {
        return { kind: "DisplayRule", document: target.document, rule };
      }

      const step = rule.steps.find((item) => sameRange(item.range, target.range));
      if (step && step.kind !== "Unknown") {
        return { kind: "RuleStep", document: target.document, ruleKind: "Display", step };
      }
    }

    for (const label of view.locLabels) {
      if (sameRange(label.range, target.range) && node.contextValue === "d365RibbonLocLabel") {
        return { kind: "LocLabel", document: target.document, label };
      }

      const title = label.titles.find((item) => sameRange(item.range, target.range));
      if (title) {
        return { kind: "LocLabelTitle", document: target.document, title };
      }
    }
  }

  return undefined;
}

function sameRange(left: { start: number; end: number }, right: { start: number; end: number }) {
  return left.start === right.start && left.end === right.end;
}

async function editCustomAction(
  ctx: CommandContext,
  document: RibbonDocument,
  action: CustomAction,
): Promise<void> {
  if (action.commandUI?.kind !== "Button") {
    vscode.window.showWarningMessage("Only Button custom actions can be edited.");
    return;
  }

  const customActionId = await promptRequired("Custom action id", action.id);
  if (customActionId === undefined) {
    return;
  }

  const location = await promptRequired("Location", action.location);
  if (location === undefined) {
    return;
  }

  const sequenceText = await vscode.window.showInputBox({
    prompt: "Sequence",
    value: action.sequence === undefined ? "" : String(action.sequence),
    validateInput: validateOptionalNumber,
  });
  if (sequenceText === undefined) {
    return;
  }

  const buttonId = await promptRequired("Button id", action.commandUI.id);
  if (buttonId === undefined) {
    return;
  }

  const commandId = await promptRequired("Command id", action.commandUI.command);
  if (commandId === undefined) {
    return;
  }

  const labelLocId = await promptOptional("Label LocLabel id", action.commandUI.labelLocId);
  if (labelLocId === undefined) {
    return;
  }

  const labelText = await promptOptional("Inline label text", action.commandUI.labelText);
  if (labelText === undefined) {
    return;
  }

  const image16x16 = await promptOptional(
    "Small icon web resource",
    action.commandUI.image16x16?.webResourceUniqueName,
  );
  if (image16x16 === undefined) {
    return;
  }

  const image32x32 = await promptOptional(
    "Large icon web resource",
    action.commandUI.image32x32?.webResourceUniqueName,
  );
  if (image32x32 === undefined) {
    return;
  }

  const templateAlias = await promptOptional("Template alias", action.commandUI.templateAlias);
  if (templateAlias === undefined) {
    return;
  }

  const input: NewCustomButtonInput = {
    customActionId: customActionId.trim(),
    location: location.trim(),
    sequence: sequenceText.trim() ? Number(sequenceText.trim()) : undefined,
    buttonId: buttonId.trim(),
    commandId: commandId.trim(),
    action: { kind: "Url", address: "" },
    labelLocId: labelLocId.trim() || undefined,
    labelText: labelText.trim() || undefined,
    image16x16: image16x16.trim() || undefined,
    image32x32: image32x32.trim() || undefined,
    templateAlias: templateAlias.trim() || undefined,
  };

  ctx.ribbonEditorState.queuePatches(document, [
    createCustomButtonReplacePatch(document.sourceText, action.range, input),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function editHideAction(
  ctx: CommandContext,
  document: RibbonDocument,
  action: HideAction,
): Promise<void> {
  const hideActionId = await promptRequired("Hide action id", action.hideActionId);
  if (hideActionId === undefined) {
    return;
  }

  const location = await promptRequired("Location", action.location);
  if (location === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(document, [
    createHideActionReplacePatch(document.sourceText, action.range, {
      hideActionId: hideActionId.trim(),
      location: location.trim(),
    }),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function editNodeId(
  ctx: CommandContext,
  document: RibbonDocument,
  range: { start: number; end: number },
  prompt: string,
  currentId: string,
): Promise<void> {
  const id = await vscode.window.showInputBox({
    prompt,
    value: currentId,
    validateInput: (value) =>
      validateUniqueId(document, value, `${prompt} is required.`, currentId),
  });
  if (id === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(document, [
    createNodeAttributeValuePatch(document.sourceText, range, "Id", id.trim()),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function editCommandAction(
  ctx: CommandContext,
  document: RibbonDocument,
  action: CommandAction,
): Promise<void> {
  const input = await promptCommandAction(ctx);
  if (!input) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(document, [
    createCommandActionReplacePatch(document.sourceText, action, input),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function editRuleStep(
  ctx: CommandContext,
  document: RibbonDocument,
  ruleKind: "Enable" | "Display",
  step: RuleStep,
): Promise<void> {
  const input = await promptRuleStep(ctx, ruleKind);
  if (!input) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(document, [
    createRuleStepReplacePatch(document.sourceText, step, input),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function editLocLabelTitle(
  ctx: CommandContext,
  document: RibbonDocument,
  title: LocLabelTitle,
): Promise<void> {
  const languageCode = await vscode.window.showInputBox({
    prompt: "Language code",
    value: String(title.languageCode),
    validateInput: (value) =>
      /^\d+$/.test(value.trim()) ? undefined : "Language code must be a number.",
  });
  if (languageCode === undefined) {
    return;
  }

  const description = await promptRequired("Text", title.description);
  if (description === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(document, [
    createLocLabelTitleReplacePatch(document.sourceText, title, {
      languageCode: Number(languageCode.trim()),
      description: description.trim(),
    }),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function pickOobCommand(
  document: RibbonDocument,
  view: RibbonView,
  options: {
    placeHolder?: string;
    manualDescription?: string;
  } = {},
): Promise<OobRibbonCommand | undefined> {
  const commands = listOobRibbonCommands(view.scope, document.entityLogicalName);
  const manual: OobCommandPick = {
    label: "Type command id",
    description: options.manualDescription ?? "Use a custom OOB command id",
    manual: true,
  };
  const items: OobCommandPick[] = [
    ...commands.map((command) => ({
      label: command.id,
      description: command.label,
      command,
    })),
    manual,
  ];
  const pick = await vscode.window.showQuickPick<OobCommandPick>(items, {
    placeHolder: options.placeHolder ?? "OOB button command to hide",
  });

  if (!pick) {
    return undefined;
  }

  if (pick.command) {
    return pick.command;
  }

  const id = await vscode.window.showInputBox({
    prompt: "OOB command id",
    placeHolder: "Mscrm.SavePrimary",
    validateInput: (value) => (value.trim() ? undefined : "Command id is required."),
  });

  return id
    ? {
        id: id.trim(),
        label: id.trim(),
        scopes: [view.scope],
        locationIds: [],
      }
    : undefined;
}

async function pickLocation(
  document: RibbonDocument,
  view: RibbonView,
  command?: OobRibbonCommand,
): Promise<string | undefined> {
  const suggestedLocations = (command?.locationIds ?? [])
    .map((id) => findOobRibbonLocation(id, document.entityLogicalName))
    .filter((location): location is NonNullable<typeof location> => !!location);
  const fallbackLocations = listOobRibbonLocations(view.scope, document.entityLogicalName);
  const locations = suggestedLocations.length ? suggestedLocations : fallbackLocations;
  const pick = await vscode.window.showQuickPick(
    [
      ...locations.map((location) => ({
        label: location.location,
        description: location.label,
      })),
      { label: "Type location", description: "Use a custom location id" },
    ],
    { placeHolder: "Ribbon location" },
  );

  if (!pick) {
    return undefined;
  }

  if (pick.label !== "Type location") {
    return pick.label;
  }

  return vscode.window.showInputBox({
    prompt: "Ribbon location",
    placeHolder: "Mscrm.Form.account.MainTab.Save.Controls._children",
    validateInput: (value) => (value.trim() ? undefined : "Location is required."),
  });
}

async function promptJavaScriptAction(ctx: CommandContext) {
  const library = await pickWebResourceLibrary(ctx);
  if (!library) {
    return undefined;
  }

  const functionName = await pickJavaScriptFunctionName(library);
  if (!functionName) {
    return undefined;
  }

  return {
    kind: "JavaScriptFunction" as const,
    library: library.uniqueName,
    functionName: functionName.trim(),
  };
}

async function promptCommandAction(
  ctx: CommandContext,
): Promise<NewCommandActionInput | undefined> {
  const actionKind = await vscode.window.showQuickPick(
    [
      { label: "JavaScript function", description: "Call a workspace web resource" },
      { label: "URL", description: "Open a URL" },
    ],
    { placeHolder: "Command action" },
  );
  if (!actionKind) {
    return undefined;
  }

  return actionKind.label === "URL" ? promptUrlAction() : promptJavaScriptAction(ctx);
}

async function promptOptionalCommandAction(
  ctx: CommandContext,
): Promise<NewCommandActionInput | undefined | null> {
  const actionKind = await vscode.window.showQuickPick(
    [
      { label: "JavaScript function", description: "Call a workspace web resource" },
      { label: "URL", description: "Open a URL" },
      { label: "No action", description: "Create an empty Actions block" },
    ],
    { placeHolder: "Command action" },
  );
  if (!actionKind) {
    return undefined;
  }

  if (actionKind.label === "No action") {
    return null;
  }

  return actionKind.label === "URL" ? promptUrlAction() : promptJavaScriptAction(ctx);
}

async function promptUrlAction() {
  const address = await vscode.window.showInputBox({
    prompt: "URL",
    placeHolder: "https://contoso.example",
    validateInput: (value) => (value.trim() ? undefined : "URL is required."),
  });
  if (!address) {
    return undefined;
  }

  return {
    kind: "Url" as const,
    address: address.trim(),
  };
}

function promptRequired(prompt: string, value: string | undefined): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    prompt,
    value: value ?? "",
    validateInput: (input) => (input.trim() ? undefined : `${prompt} is required.`),
  });
}

function promptOptional(prompt: string, value: string | undefined): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    prompt,
    value: value ?? "",
  });
}

function validateOptionalNumber(value: string): string | undefined {
  return value.trim() === "" || /^\d+$/.test(value.trim()) ? undefined : "Use a number.";
}

async function pickWebResourceLibrary(
  ctx: CommandContext,
): Promise<WebResourceLibraryPick | undefined> {
  const picks = await listBoundJavaScriptLibraries(ctx);
  const manualPick: WebResourceLibraryPick = {
    label: "Type schema name manually",
    description: "Use an external or unbound web resource",
    uniqueName: "",
    manual: true,
  };

  const pick = await vscode.window.showQuickPick([...picks, manualPick], {
    placeHolder: "JavaScript web resource",
  });
  if (!pick) {
    return undefined;
  }

  if (!pick.manual) {
    return pick;
  }

  const uniqueName = await vscode.window.showInputBox({
    prompt: "JavaScript web resource schema name",
    placeHolder: "new_/scripts/account.js",
    validateInput: (value) =>
      normalizeWebResourceUniqueName(value) ? undefined : "Schema name is required.",
  });
  const normalized = normalizeWebResourceUniqueName(uniqueName ?? "");

  return normalized
    ? {
        label: normalized,
        uniqueName: normalized,
      }
    : undefined;
}

async function listBoundJavaScriptLibraries(
  ctx: CommandContext,
): Promise<WebResourceLibraryPick[]> {
  const snapshot = await ctx.bindings.listBindings();
  const picks: WebResourceLibraryPick[] = [];

  for (const binding of snapshot.bindings) {
    if (binding.kind === "file") {
      const uniqueName = binding.remotePath.replace(/\\/g, "/");
      if (uniqueName.toLowerCase().endsWith(".js")) {
        picks.push({
          label: uniqueName,
          description: ctx.configuration.getRelativeToWorkspace(
            ctx.configuration.resolveLocalPath(binding.relativeLocalPath),
          ),
          uniqueName,
          localPath: ctx.configuration.resolveLocalPath(binding.relativeLocalPath),
        });
      }
      continue;
    }

    picks.push(...(await listFolderJavaScriptLibraries(ctx, binding)));
  }

  return picks.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

async function listFolderJavaScriptLibraries(
  ctx: CommandContext,
  binding: BindingEntry,
): Promise<WebResourceLibraryPick[]> {
  const root = ctx.configuration.resolveLocalPath(binding.relativeLocalPath);
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(root, "**/*.js"),
    "**/node_modules/**",
  );

  return files.map((file) => {
    const relative = path.relative(root, file.fsPath).replace(/\\/g, "/");
    const uniqueName = joinRemotePath(binding.remotePath, relative);
    return {
      label: uniqueName,
      description: ctx.configuration.getRelativeToWorkspace(file.fsPath),
      uniqueName,
      localPath: file.fsPath,
    };
  });
}

async function pickJavaScriptFunctionName(
  library: WebResourceLibraryPick,
): Promise<string | undefined> {
  const suggestions = await listJavaScriptFunctionSuggestions(library.localPath);
  if (!suggestions.length) {
    return vscode.window.showInputBox({
      prompt: "JavaScript function name",
      placeHolder: "validateAndSave",
      validateInput: (value) => (value.trim() ? undefined : "Function name is required."),
    });
  }

  const manual = "Type function name";
  const pick = await vscode.window.showQuickPick(
    [...suggestions.map((name) => ({ label: name })), { label: manual }],
    { placeHolder: "JavaScript function name" },
  );
  if (!pick) {
    return undefined;
  }

  if (pick.label !== manual) {
    return pick.label;
  }

  return vscode.window.showInputBox({
    prompt: "JavaScript function name",
    placeHolder: "validateAndSave",
    validateInput: (value) => (value.trim() ? undefined : "Function name is required."),
  });
}

async function listJavaScriptFunctionSuggestions(localPath: string | undefined): Promise<string[]> {
  if (!localPath) {
    return [];
  }

  const stat = await vscode.workspace.fs.stat(vscode.Uri.file(localPath)).then(
    (value) => value,
    () => undefined,
  );
  if (!stat || stat.size > 256 * 1024) {
    return [];
  }

  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(localPath));
  const source = Buffer.from(bytes).toString("utf8");
  const names = new Set<string>();
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:^|[;\n]\s*)([A-Za-z_$][\w$]*)\s*=\s*function\s*\(/g,
    /(?:^|[;\n]\s*)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*=\s*function\s*\(/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      names.add(match[1]);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

async function addRibbonRule(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
  kind: "Enable" | "Display",
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const id = await vscode.window.showInputBox({
    prompt: `${kind} rule id`,
    placeHolder: `d365tools.${target.document.entityLogicalName ?? "application"}.${target.view.scope}.${kind}Rule`,
    validateInput: (value) => validateUniqueId(target.document, value, "Rule id is required."),
  });
  if (!id) {
    return;
  }

  const step = await promptRuleStep(ctx, kind);
  if (step === undefined) {
    return;
  }

  const createPatches = kind === "Enable" ? createEnableRulePatches : createDisplayRulePatches;
  ctx.ribbonEditorState.queuePatches(
    target.document,
    createPatches(target.document, {
      id: id.trim(),
      step: step ?? undefined,
    }),
  );
  ctx.ribbonExplorer.refresh();
}

async function addRibbonCommandRuleRef(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
  kind: "EnableRule" | "DisplayRule",
): Promise<void> {
  const target = resolveCommandTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a command definition first.");
    return;
  }

  const ruleId =
    kind === "EnableRule"
      ? await pickRuleId(
          "Enable rule",
          target.document,
          target.command.enableRuleRefs,
          (view) => view.enableRules,
        )
      : await pickRuleId(
          "Display rule",
          target.document,
          target.command.displayRuleRefs,
          (view) => view.displayRules,
        );
  if (!ruleId) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(target.document, [
    createCommandRuleRefPatch(target.document, target.command, kind, ruleId.trim()),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function pickRuleId<T extends EnableRule | DisplayRule>(
  label: string,
  document: RibbonDocument,
  currentRefs: string[],
  selectRules: (view: RibbonView) => T[],
): Promise<string | undefined> {
  const used = new Set(currentRefs);
  const rules = uniqueById(document.views.flatMap(selectRules)).filter(
    (rule) => !used.has(rule.id),
  );
  const manual = `Type ${label.toLowerCase()} id`;
  const pick = await vscode.window.showQuickPick(
    [
      ...rules.map((rule) => ({ label: rule.id })),
      { label: manual, description: "Use an id that is not in this view yet" },
    ],
    { placeHolder: label },
  );
  if (!pick) {
    return undefined;
  }

  if (pick.label !== manual) {
    return pick.label;
  }

  const id = await vscode.window.showInputBox({
    prompt: `${label} id`,
    validateInput: (value) => {
      const id = value.trim();
      if (!id) {
        return `${label} id is required.`;
      }
      return currentRefs.includes(id) ? "This command already references this rule." : undefined;
    },
  });
  return id?.trim();
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

async function promptRuleStep(
  ctx: CommandContext,
  ruleKind: "Enable" | "Display",
): Promise<NewRuleStepInput | null | undefined> {
  const common = [
    { label: "CustomRule", description: "Call a JavaScript function" },
    { label: "FormStateRule", description: "Check form state" },
    { label: "CommandClientTypeRule", description: "Modern or refresh client" },
  ];
  const displayOnly = [
    { label: "ValueRule", description: "Check a field value" },
    { label: "EntityPrivilegeRule", description: "Check entity privilege" },
  ];
  const pick = await vscode.window.showQuickPick(
    [
      ...(ruleKind === "Display" ? displayOnly : []),
      ...common,
      { label: "No step", description: "Create an empty rule" },
    ],
    { placeHolder: "First rule step" },
  );
  if (!pick) {
    return undefined;
  }

  switch (pick.label) {
    case "No step":
      return null;
    case "CustomRule":
      return promptCustomRuleStep(ctx);
    case "FormStateRule":
      return promptFormStateRuleStep();
    case "CommandClientTypeRule":
      return promptCommandClientTypeRuleStep();
    case "ValueRule":
      return promptValueRuleStep();
    case "EntityPrivilegeRule":
      return promptEntityPrivilegeRuleStep();
    default:
      return undefined;
  }
}

async function promptCustomRuleStep(ctx: CommandContext): Promise<NewRuleStepInput | undefined> {
  const action = await promptJavaScriptAction(ctx);
  if (!action || action.kind !== "JavaScriptFunction") {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return {
    kind: "CustomRule",
    library: action.library,
    functionName: action.functionName,
    invertResult,
  };
}

async function promptFormStateRuleStep(): Promise<NewRuleStepInput | undefined> {
  const state = await vscode.window.showQuickPick(["Create", "Existing", "ReadOnly", "Disabled"], {
    placeHolder: "Form state",
  });
  if (!state) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return { kind: "FormStateRule", state, invertResult };
}

async function promptCommandClientTypeRuleStep(): Promise<NewRuleStepInput | undefined> {
  const type = await vscode.window.showQuickPick(["Modern", "Refresh"], {
    placeHolder: "Client type",
  });
  return type ? { kind: "CommandClientTypeRule", type: type as "Modern" | "Refresh" } : undefined;
}

async function promptValueRuleStep(): Promise<NewRuleStepInput | undefined> {
  const field = await vscode.window.showInputBox({
    prompt: "Field name",
    placeHolder: "statuscode",
    validateInput: (value) => (value.trim() ? undefined : "Field name is required."),
  });
  if (!field) {
    return undefined;
  }

  const value = await vscode.window.showInputBox({
    prompt: "Value",
    validateInput: (input) => (input.trim() ? undefined : "Value is required."),
  });
  if (!value) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return { kind: "ValueRule", field: field.trim(), value: value.trim(), invertResult };
}

async function promptEntityPrivilegeRuleStep(): Promise<NewRuleStepInput | undefined> {
  const privilegeType = await vscode.window.showQuickPick(
    ["Create", "Read", "Write", "Delete", "Append", "AppendTo", "Assign", "Share"],
    { placeHolder: "Privilege type" },
  );
  if (!privilegeType) {
    return undefined;
  }

  const entityName = await vscode.window.showInputBox({
    prompt: "Entity logical name",
    placeHolder: "account",
  });
  const privilegeDepth = await vscode.window.showQuickPick(["Basic", "Local", "Deep", "Global"], {
    placeHolder: "Privilege depth",
  });
  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return {
    kind: "EntityPrivilegeRule",
    entityName: entityName?.trim() || undefined,
    privilegeType,
    privilegeDepth,
    invertResult,
  };
}

async function promptOptionalBoolean(prompt: string): Promise<boolean | undefined> {
  const pick = await vscode.window.showQuickPick(["No", "Yes"], { placeHolder: prompt });
  if (!pick) {
    return undefined;
  }

  return pick === "Yes";
}

function joinRemotePath(root: string, relative: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${relative.replace(/^[\\/]+/, "")}`.replace(/\\/g, "/");
}

export function normalizeWebResourceUniqueName(value: string): string {
  return value
    .trim()
    .replace(/^\$webresource:/i, "")
    .replace(/\\/g, "/");
}

function nextCustomActionSequence(view: RibbonView): number {
  const sequences = view.customActions
    .map((action) => action.sequence)
    .filter((sequence): sequence is number => typeof sequence === "number");
  return sequences.length ? Math.max(...sequences) + 10 : 10;
}

function validateUniqueId(
  document: RibbonDocument,
  value: string,
  requiredMessage: string,
  allowedId?: string,
): string | undefined {
  const id = value.trim();
  if (!id) {
    return requiredMessage;
  }

  if (allowedId && id === allowedId) {
    return undefined;
  }

  const used = new Set<string>();
  for (const view of document.views) {
    for (const action of view.customActions) {
      used.add(action.id);
      if (action.commandUI && action.commandUI.kind !== "Unknown") {
        used.add(action.commandUI.id);
      }
    }
    for (const action of view.hideActions) {
      used.add(action.hideActionId);
    }
    for (const command of view.commandDefinitions) {
      used.add(command.id);
    }
    for (const rule of view.enableRules) {
      used.add(rule.id);
    }
    for (const rule of view.displayRules) {
      used.add(rule.id);
    }
    for (const label of view.locLabels) {
      used.add(label.id);
    }
  }

  return used.has(id) ? "This id already exists in this ribbon." : undefined;
}
