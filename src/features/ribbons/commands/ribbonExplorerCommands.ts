import * as vscode from "vscode";
import * as path from "node:path";
import { CommandContext } from "../../../app/commandContext";
import { BindingEntry } from "../../config/domain/models";
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
  createLocLabelPatches,
  createNodeAttributeValuePatch,
  createRuleStepReplacePatch,
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
}

export function refreshRibbonExplorer(ctx: CommandContext): void {
  ctx.ribbonExplorer.refresh();
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

export async function openRibbonFile(node?: RibbonDocumentNode): Promise<void> {
  if (!(node instanceof RibbonDocumentNode)) {
    vscode.window.showWarningMessage("Select a ribbon document first.");
    return;
  }

  await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(node.document.fileUri));
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

  const action = await promptCommandAction(ctx);
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

export async function addRibbonCommandAction(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveCommandTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a command definition first.");
    return;
  }

  const action = await promptOptionalCommandAction(ctx);
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
): Promise<OobRibbonCommand | undefined> {
  const commands = listOobRibbonCommands(view.scope, document.entityLogicalName);
  const manual: OobCommandPick = {
    label: "Type command id",
    description: "Use a custom OOB command id",
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
    placeHolder: "OOB button command to hide",
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
  if (!picks.length) {
    vscode.window.showWarningMessage("No bound JavaScript web resources were found.");
    return undefined;
  }

  return vscode.window.showQuickPick(picks, {
    placeHolder: "JavaScript web resource",
  });
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
