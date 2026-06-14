import * as vscode from "vscode";
import { CommandContext } from "@app/commandContext";
import {
  createRibbonControlChildPatches,
  createCustomControlPatches,
  createCustomButtonPatches,
  createHideActionPatches,
  createOobButtonReorderPatches,
  createOobStubReplacementPatches,
  makeCustomControlIds,
  makeCustomButtonIds,
  makeHideActionId,
  nextHideActionId,
  NewCommandActionInput,
} from "../ribbonEditPatches";
import { RibbonExplorerNode, RibbonItemNode } from "../ribbonExplorer";
import {
  ActionParameter,
  ButtonNode,
  RibbonCommandUINode,
  RibbonDocument,
  RibbonScope,
  RibbonView,
} from "../models";
import {
  findOobRibbonLocation,
  listOobRibbonCommands,
  listOobRibbonLocations,
  OobRibbonCommand,
  OobRibbonLocation,
} from "../oobCatalog";
import { buildSmartButtonInput } from "../ribbonSmartButtons";
import {
  promptJavaScriptAction,
  promptUrlAction,
  validateOptionalNumber,
} from "./ribbonActionPrompts";
import {
  collectRibbonIds,
  inferRibbonScope,
  nextBatchId,
  nextCustomActionSequence,
  resolveRibbonTarget,
  sameRange,
} from "./ribbonCommandSupport";
import { showRibbonInputBox, showRibbonQuickPick } from "./ribbonPromptUi";
import { pickImageWebResource } from "./ribbonResourcePrompts";

interface OobCommandPick extends vscode.QuickPickItem {
  command?: OobRibbonCommand;
  manual?: boolean;
}

interface LocationPick extends vscode.QuickPickItem {
  location?: string;
  manual?: boolean;
}

type AddRibbonItemKind =
  | "smartButton"
  | "customButton"
  | "group"
  | "flyout"
  | "splitButton"
  | "menuSection";

interface AddRibbonItemPick extends vscode.QuickPickItem {
  itemKind: AddRibbonItemKind;
}

type SmartButtonTemplateKind =
  | "quickJs"
  | "openDialog"
  | "runWebhook"
  | "runReport"
  | "runWorkflow";

interface SmartButtonTemplatePick extends vscode.QuickPickItem {
  templateKind: SmartButtonTemplateKind;
  defaultLabel: string;
}

const SMART_BUTTON_TEMPLATES: SmartButtonTemplatePick[] = [
  {
    templateKind: "quickJs",
    label: "Quick JS",
    description: "Call a JavaScript web resource",
    defaultLabel: "Run script",
  },
  {
    templateKind: "openDialog",
    label: "Open Dialog",
    description: "Call JavaScript with dialog parameters",
    defaultLabel: "Open dialog",
  },
  {
    templateKind: "runWebhook",
    label: "Run Webhook",
    description: "Open a webhook URL with CRM parameters",
    defaultLabel: "Run webhook",
  },
  {
    templateKind: "runReport",
    label: "Run Report",
    description: "Call JavaScript with a report id",
    defaultLabel: "Run report",
  },
  {
    templateKind: "runWorkflow",
    label: "Run Workflow",
    description: "Call JavaScript with a workflow id",
    defaultLabel: "Run workflow",
  },
];

const ROOT_RIBBON_ITEM_TYPES: AddRibbonItemPick[] = [
  {
    itemKind: "smartButton",
    label: "Smart Button",
    description: "Create a button from an action template",
  },
  {
    itemKind: "customButton",
    label: "Custom Button",
    description: "Set labels, images, and action",
  },
  {
    itemKind: "group",
    label: "Group",
    description: "Add a ribbon group",
  },
  {
    itemKind: "flyout",
    label: "Flyout",
    description: "Add a menu button",
  },
  {
    itemKind: "splitButton",
    label: "Split Button",
    description: "Add a button with a menu",
  },
  {
    itemKind: "menuSection",
    label: "Menu Section",
    description: "Add a menu section",
  },
];

const CHILD_RIBBON_ITEM_TYPES: AddRibbonItemPick[] = [
  ROOT_RIBBON_ITEM_TYPES[1],
  ROOT_RIBBON_ITEM_TYPES[3],
  ROOT_RIBBON_ITEM_TYPES[4],
];

export async function addCustomRibbonButton(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const childTarget = resolveChildControlTarget(node, [
    "Group",
    "MenuSection",
    "SplitButton",
    "Flyout",
  ]);
  const target = resolveRibbonTarget(node) ?? childTarget;
  if (!target) {
    await ctx.core.notifications.warning("Select a ribbon scope first.");
    return;
  }

  const label = await showRibbonInputBox({
    prompt: "Button label",
    placeHolder: "Validate and save",
    validateInput: (value) => (value.trim() ? undefined : "Button label is required."),
  });
  if (!label) {
    return;
  }
  const labelValue = label.trim();

  const alt = await showRibbonInputBox({
    prompt: "Alt",
    value: labelValue,
  });
  if (alt === undefined) {
    return;
  }

  const toolTipTitle = await showRibbonInputBox({
    prompt: "Tool tip title",
    value: labelValue,
  });
  if (toolTipTitle === undefined) {
    return;
  }

  const toolTipDescription = await showRibbonInputBox({
    prompt: "Tool tip description",
    value: labelValue,
  });
  if (toolTipDescription === undefined) {
    return;
  }

  const image16x16 = await pickImageWebResource(ctx, "image16x16");
  if (image16x16 === undefined) {
    return;
  }

  const image32x32 = await pickImageWebResource(ctx, "image32x32");
  if (image32x32 === undefined) {
    return;
  }

  const modernImage = await pickImageWebResource(ctx, "modernImage");
  if (modernImage === undefined) {
    return;
  }

  const sequenceText = await showRibbonInputBox({
    prompt: "Sequence",
    value: String(
      childTarget
        ? nextChildControlSequence(childTarget.control)
        : nextCustomActionSequence(target.view),
    ),
    validateInput: validateOptionalNumber,
  });
  if (sequenceText === undefined) {
    return;
  }

  const location = childTarget ? undefined : await pickLocation(target.document, target.view.scope);
  if (!childTarget && !location) {
    return;
  }

  const actionKind = await showRibbonQuickPick(
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
  const altLocId = ids.altLocId ?? `${ids.buttonId}.Alt`;
  const toolTipTitleLocId = ids.toolTipTitleLocId ?? `${ids.buttonId}.ToolTipTitle`;
  const toolTipDescriptionLocId =
    ids.toolTipDescriptionLocId ?? `${ids.buttonId}.ToolTipDescription`;
  const action =
    actionKind.label === "URL" ? await promptUrlAction() : await promptJavaScriptAction(ctx);
  if (!action) {
    return;
  }

  const locLabels = [
    newLocLabel(labelLocId, labelValue),
    optionalLocLabel(altLocId, alt),
    optionalLocLabel(toolTipTitleLocId, toolTipTitle),
    optionalLocLabel(toolTipDescriptionLocId, toolTipDescription),
  ].filter((label): label is ReturnType<typeof newLocLabel> => Boolean(label));

  const sequence = sequenceText.trim() ? Number(sequenceText.trim()) : undefined;
  if (childTarget) {
    ctx.ribbon.editorState.queuePatches(
      target.document,
      createRibbonControlChildPatches(target.document, {
        parentRange: childTarget.control.range,
        control: {
          kind: "Button",
          id: ids.buttonId,
          commandId: ids.commandId,
          sequence,
          labelLocId,
          altLocId: locLabels.some((label) => label.id === altLocId) ? altLocId : undefined,
          toolTipTitleLocId: locLabels.some((label) => label.id === toolTipTitleLocId)
            ? toolTipTitleLocId
            : undefined,
          toolTipDescriptionLocId: locLabels.some((label) => label.id === toolTipDescriptionLocId)
            ? toolTipDescriptionLocId
            : undefined,
          image16x16: image16x16?.trim() || undefined,
          image32x32: image32x32?.trim() || undefined,
          modernImage: modernImage.trim() || undefined,
          templateAlias: "o1",
        },
        commandDefinitions: [{ id: ids.commandId, action }],
        locLabels,
      }),
    );
    ctx.ribbon.explorer.refresh();
    return;
  }

  ctx.ribbon.editorState.queuePatches(
    target.document,
    createCustomButtonPatches(target.document, {
      ...ids,
      location: location ?? "",
      action,
      sequence,
      labelLocId,
      altLocId: locLabels.some((label) => label.id === altLocId) ? altLocId : undefined,
      toolTipTitleLocId: locLabels.some((label) => label.id === toolTipTitleLocId)
        ? toolTipTitleLocId
        : undefined,
      toolTipDescriptionLocId: locLabels.some((label) => label.id === toolTipDescriptionLocId)
        ? toolTipDescriptionLocId
        : undefined,
      image16x16: image16x16?.trim() || undefined,
      image32x32: image32x32?.trim() || undefined,
      modernImage: modernImage.trim() || undefined,
      templateAlias: "o1",
      locLabels,
    }),
  );
  ctx.ribbon.explorer.refresh();
}

export async function addSmartRibbonButton(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const itemType = await pickRibbonItemType(ctx, node);
  if (!itemType) {
    return;
  }

  switch (itemType.itemKind) {
    case "customButton":
      await addCustomRibbonButton(ctx, node);
      return;
    case "group":
      await addCustomRibbonGroup(ctx, node);
      return;
    case "flyout":
      await addCustomRibbonFlyout(ctx, node);
      return;
    case "splitButton":
      await addCustomRibbonSplitButton(ctx, node);
      return;
    case "menuSection":
      await addCustomRibbonMenuSection(ctx, node);
      return;
    case "smartButton":
      await addSmartRibbonButtonFromTemplate(ctx, node);
      return;
  }
}

async function pickRibbonItemType(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
): Promise<AddRibbonItemPick | undefined> {
  const target = resolveRibbonTarget(node);
  const childTarget = resolveChildControlTarget(node, [
    "Group",
    "MenuSection",
    "SplitButton",
    "Flyout",
  ]);
  if (!target && !childTarget) {
    await ctx.core.notifications.warning("Select a ribbon scope first.");
    return undefined;
  }

  const picks = target
    ? ROOT_RIBBON_ITEM_TYPES
    : [
        ...CHILD_RIBBON_ITEM_TYPES,
        ...(resolveChildControlTarget(node, ["SplitButton", "Flyout"])
          ? [ROOT_RIBBON_ITEM_TYPES[5]]
          : []),
      ];

  return showRibbonQuickPick(picks, {
    placeHolder: "Ribbon item type",
  });
}

async function addSmartRibbonButtonFromTemplate(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    await ctx.core.notifications.warning("Select a ribbon scope first.");
    return;
  }

  const template = await showRibbonQuickPick(SMART_BUTTON_TEMPLATES, {
    placeHolder: "Smart button template",
  });
  if (!template) {
    return;
  }

  const label = await showRibbonInputBox({
    prompt: "Button label",
    value: template.defaultLabel,
    validateInput: (value) => (value.trim() ? undefined : "Button label is required."),
  });
  if (!label) {
    return;
  }

  const sequenceText = await showRibbonInputBox({
    prompt: "Sequence",
    value: String(nextCustomActionSequence(target.view)),
    validateInput: validateOptionalNumber,
  });
  if (sequenceText === undefined) {
    return;
  }

  const location = await pickLocation(target.document, target.view.scope);
  if (!location) {
    return;
  }

  const action = await promptSmartButtonAction(ctx, template.templateKind);
  if (!action) {
    return;
  }

  const sequence = sequenceText.trim() ? Number(sequenceText.trim()) : undefined;
  const input = buildSmartButtonInput(target.document, target.view.scope, {
    label: label.trim(),
    location,
    sequence,
    action,
  });

  ctx.ribbon.editorState.queuePatches(
    target.document,
    createCustomButtonPatches(target.document, input),
  );
  ctx.ribbon.explorer.refresh();
}

async function promptSmartButtonAction(
  ctx: CommandContext,
  kind: SmartButtonTemplateKind,
): Promise<NewCommandActionInput | undefined> {
  if (kind === "quickJs") {
    return promptJavaScriptAction(ctx);
  }

  if (kind === "runWebhook") {
    const address = await showRibbonInputBox({
      prompt: "Webhook URL",
      placeHolder: "https://example.com/api/ribbon",
      validateInput: (value) => (value.trim() ? undefined : "Webhook URL is required."),
    });
    if (!address) {
      return undefined;
    }

    return {
      kind: "Url",
      address: address.trim(),
      passParams: true,
      parameters: [{ kind: "Crm", value: "PrimaryControl" }],
    };
  }

  const action = await promptJavaScriptAction(ctx);
  if (!action || action.kind !== "JavaScriptFunction") {
    return action;
  }

  const templateParameters = await promptSmartButtonTypedParameters(kind);
  if (templateParameters === undefined) {
    return undefined;
  }

  return {
    ...action,
    parameters: [...(action.parameters ?? []), ...templateParameters],
  };
}

async function promptSmartButtonTypedParameters(
  kind: Exclude<SmartButtonTemplateKind, "quickJs" | "runWebhook">,
): Promise<ActionParameter[] | undefined> {
  if (kind === "openDialog") {
    const pageName = await showRibbonInputBox({
      prompt: "Dialog page name",
      placeHolder: "new_accountdialog",
      validateInput: (value) => (value.trim() ? undefined : "Dialog page name is required."),
    });
    if (!pageName) {
      return undefined;
    }

    return [
      { kind: "Crm", value: "PrimaryControl" },
      { kind: "String", name: "pageName", value: pageName.trim() },
    ];
  }

  const prompt = kind === "runReport" ? "Report id" : "Workflow id";
  const parameterName = kind === "runReport" ? "reportId" : "workflowId";
  const value = await showRibbonInputBox({
    prompt,
    placeHolder: "00000000-0000-0000-0000-000000000000",
    validateInput: (input) => (input.trim() ? undefined : `${prompt} is required.`),
  });
  if (!value) {
    return undefined;
  }

  return [
    { kind: "Crm", value: "PrimaryControl" },
    { kind: "String", name: parameterName, value: value.trim() },
  ];
}

export async function addCustomRibbonGroup(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    await ctx.core.notifications.warning("Select a ribbon scope first.");
    return;
  }

  const title = await showRibbonInputBox({
    prompt: "Group title",
    placeHolder: "Custom actions",
    validateInput: (value) => (value.trim() ? undefined : "Group title is required."),
  });
  if (!title) {
    return;
  }
  const titleValue = title.trim();

  const sequenceText = await showRibbonInputBox({
    prompt: "Sequence",
    value: String(nextCustomActionSequence(target.view)),
    validateInput: validateOptionalNumber,
  });
  if (sequenceText === undefined) {
    return;
  }

  const location = await promptRibbonLocation({
    prompt: "Group location",
    value: defaultGroupLocation(target.document, target.view.scope),
    placeHolder: "Mscrm.Form.account.MainTab.Groups._children",
  });
  if (!location) {
    return;
  }

  const ids = makeCustomControlIds(target.document, target.view.scope, titleValue, "Group");
  const sequence = sequenceText.trim() ? Number(sequenceText.trim()) : undefined;
  ctx.ribbon.editorState.queuePatches(
    target.document,
    createCustomControlPatches(target.document, {
      customActionId: ids.customActionId,
      location,
      sequence,
      control: {
        kind: "Group",
        id: ids.controlId,
        title: titleValue,
        sequence,
      },
    }),
  );
  ctx.ribbon.explorer.refresh();
}

export async function addCustomRibbonMenuSection(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const childTarget = resolveChildControlTarget(node, ["SplitButton", "Flyout"]);
  const target = resolveRibbonTarget(node) ?? childTarget;
  if (!target) {
    await ctx.core.notifications.warning("Select a ribbon scope first.");
    return;
  }

  const name = await showRibbonInputBox({
    prompt: "Menu section name",
    placeHolder: "More actions",
    validateInput: (value) => (value.trim() ? undefined : "Menu section name is required."),
  });
  if (!name) {
    return;
  }
  const nameValue = name.trim();

  const displayMode = await showRibbonQuickPick(["Menu16", "Menu32"], {
    placeHolder: "Menu section display mode",
  });
  if (!displayMode) {
    return;
  }

  const sequenceText = await showRibbonInputBox({
    prompt: "Sequence",
    value: String(
      childTarget
        ? nextChildControlSequence(childTarget.control)
        : nextCustomActionSequence(target.view),
    ),
    validateInput: validateOptionalNumber,
  });
  if (sequenceText === undefined) {
    return;
  }

  const location = childTarget
    ? undefined
    : await promptRibbonLocation({
        prompt: "Menu section location",
        value: defaultMenuSectionLocation(target.document, target.view.scope),
        placeHolder: "Mscrm.Form.account.MainTab.Actions.MenuSections._children",
      });
  if (!childTarget && !location) {
    return;
  }

  const ids = makeCustomControlIds(target.document, target.view.scope, nameValue, "MenuSection");
  const sequence = sequenceText.trim() ? Number(sequenceText.trim()) : undefined;
  if (childTarget) {
    ctx.ribbon.editorState.queuePatches(
      target.document,
      createRibbonControlChildPatches(target.document, {
        parentRange: childTarget.control.range,
        control: {
          kind: "MenuSection",
          id: ids.controlId,
          displayMode,
          sequence,
        },
      }),
    );
    ctx.ribbon.explorer.refresh();
    return;
  }

  ctx.ribbon.editorState.queuePatches(
    target.document,
    createCustomControlPatches(target.document, {
      customActionId: ids.customActionId,
      location: location ?? "",
      sequence,
      control: {
        kind: "MenuSection",
        id: ids.controlId,
        displayMode,
        sequence,
      },
    }),
  );
  ctx.ribbon.explorer.refresh();
}

export async function addCustomRibbonFlyout(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addCustomDropdownControl(ctx, node, {
    kind: "Flyout",
    labelPrompt: "Flyout label",
    locationPrompt: "Flyout location",
    locationPlaceHolder: "Mscrm.Form.account.MainTab.Actions.Controls._children",
  });
}

export async function addCustomRibbonSplitButton(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addCustomDropdownControl(ctx, node, {
    kind: "SplitButton",
    labelPrompt: "Split button label",
    locationPrompt: "Split button location",
    locationPlaceHolder: "Mscrm.Form.account.MainTab.Actions.Controls._children",
  });
}

async function addCustomDropdownControl(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
  options: {
    kind: "Flyout" | "SplitButton";
    labelPrompt: string;
    locationPrompt: string;
    locationPlaceHolder: string;
  },
): Promise<void> {
  const childTarget = resolveChildControlTarget(node, [
    "Group",
    "MenuSection",
    "SplitButton",
    "Flyout",
  ]);
  const target = resolveRibbonTarget(node) ?? childTarget;
  if (!target) {
    await ctx.core.notifications.warning("Select a ribbon scope first.");
    return;
  }

  const label = await showRibbonInputBox({
    prompt: options.labelPrompt,
    placeHolder: options.kind === "Flyout" ? "More actions" : "Main action",
    validateInput: (value) => (value.trim() ? undefined : "Label is required."),
  });
  if (!label) {
    return;
  }
  const labelValue = label.trim();

  const sequenceText = await showRibbonInputBox({
    prompt: "Sequence",
    value: String(
      childTarget
        ? nextChildControlSequence(childTarget.control)
        : nextCustomActionSequence(target.view),
    ),
    validateInput: validateOptionalNumber,
  });
  if (sequenceText === undefined) {
    return;
  }

  const location = childTarget
    ? undefined
    : await promptRibbonLocation({
        prompt: options.locationPrompt,
        value: defaultDropdownLocation(target.document, target.view.scope),
        placeHolder: options.locationPlaceHolder,
      });
  if (!childTarget && !location) {
    return;
  }

  const ids = makeCustomControlIds(target.document, target.view.scope, labelValue, options.kind);
  const sequence = sequenceText.trim() ? Number(sequenceText.trim()) : undefined;
  const labelLocId = `${ids.controlId}.Label`;

  if (childTarget) {
    ctx.ribbon.editorState.queuePatches(
      target.document,
      createRibbonControlChildPatches(target.document, {
        parentRange: childTarget.control.range,
        control: {
          kind: options.kind,
          id: ids.controlId,
          labelLocId,
          sequence,
        },
        locLabels: [newLocLabel(labelLocId, labelValue)],
      }),
    );
    ctx.ribbon.explorer.refresh();
    return;
  }

  ctx.ribbon.editorState.queuePatches(
    target.document,
    createCustomControlPatches(target.document, {
      customActionId: ids.customActionId,
      location: location ?? "",
      sequence,
      control: {
        kind: options.kind,
        id: ids.controlId,
        labelLocId,
        sequence,
      },
      locLabels: [newLocLabel(labelLocId, labelValue)],
    }),
  );
  ctx.ribbon.explorer.refresh();
}

function newLocLabel(id: string, description: string) {
  return {
    id,
    languageCode: 1033,
    description: description.trim(),
  };
}

function resolveChildControlTarget(
  node: RibbonExplorerNode | undefined,
  allowedKinds: RibbonCommandUINode["kind"][],
): { document: RibbonDocument; view: RibbonView; control: RibbonCommandUINode } | undefined {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    return undefined;
  }

  for (const view of node.editTarget.document.views) {
    for (const action of view.customActions) {
      if (!action.commandUI) {
        continue;
      }

      const control = findRibbonControlByRange(action.commandUI, node.editTarget.range);
      if (control && allowedKinds.includes(control.kind)) {
        return { document: node.editTarget.document, view, control };
      }
    }
  }

  return undefined;
}

function findRibbonControlByRange(
  control: RibbonCommandUINode,
  range: { start: number; end: number },
): RibbonCommandUINode | undefined {
  if (sameRange(control.range, range)) {
    return control;
  }

  if (control.kind === "Unknown" || !("children" in control)) {
    return undefined;
  }

  for (const child of control.children ?? []) {
    const match = findRibbonControlByRange(child, range);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function nextChildControlSequence(control: RibbonCommandUINode): number {
  if (control.kind === "Unknown" || !("children" in control)) {
    return 10;
  }

  const sequences = (control.children ?? [])
    .map((child) => (child.kind === "Unknown" ? undefined : child.sequence))
    .filter((sequence): sequence is number => sequence !== undefined);
  return sequences.length ? Math.max(...sequences) + 10 : 10;
}

function optionalLocLabel(id: string, description: string) {
  return description.trim() ? newLocLabel(id, description) : undefined;
}

async function promptRibbonLocation(input: {
  prompt: string;
  value: string;
  placeHolder: string;
}): Promise<string | undefined> {
  return showRibbonInputBox({
    prompt: input.prompt,
    value: input.value,
    placeHolder: input.placeHolder,
    validateInput: (value) => (value.trim() ? undefined : "Location is required."),
  });
}

function defaultGroupLocation(document: RibbonDocument, scope: RibbonScope): string {
  return `${scopePrefix(document, scope)}.MainTab.Groups._children`;
}

function defaultMenuSectionLocation(document: RibbonDocument, scope: RibbonScope): string {
  return `${scopePrefix(document, scope)}.MainTab.Actions.MenuSections._children`;
}

function defaultDropdownLocation(document: RibbonDocument, scope: RibbonScope): string {
  return `${scopePrefix(document, scope)}.MainTab.Actions.Controls._children`;
}

function scopePrefix(document: RibbonDocument, scope: RibbonScope): string {
  if (scope === "Application") {
    return "Mscrm.GlobalTab";
  }

  const entity = document.entityLogicalName ?? "{entity}";
  return `Mscrm.${scope}.${entity}`;
}

export async function hideOobRibbonButton(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    await ctx.core.notifications.warning("Select a ribbon scope first.");
    return;
  }

  const command = await pickOobCommand(target.document, target.view);
  if (!command) {
    return;
  }

  const location = await pickHideLocation(target.document, target.view, command);
  if (!location) {
    return;
  }

  const choice = await ctx.core.notifications.askWarning(
    `Hide OOB button "${command.label}"?`,
    ["Hide"],
    { modal: true },
  );
  if (choice !== "Hide") {
    return;
  }

  const baseId = makeHideActionId(target.document, target.view.scope, getOobControlId(command));
  const hideActionId = nextHideActionId(target.document, { hideActionId: baseId });
  ctx.ribbon.editorState.queuePatches(
    target.document,
    createHideActionPatches(target.document, { hideActionId, location }),
  );
  ctx.ribbon.explorer.refresh();
}

export async function hideAndStubOobRibbonButtons(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    await ctx.core.notifications.warning("Select a ribbon scope first.");
    return;
  }

  const location = await pickLocation(target.document, target.view.scope);
  if (!location) {
    return;
  }

  const commands = await pickOobCommandsForLocation(target.document, target.view, location);
  if (!commands?.length) {
    return;
  }

  const choice = await ctx.core.notifications.askWarning(
    `Hide ${commands.length} OOB button${commands.length === 1 ? "" : "s"} and create replacement stubs?`,
    ["Create Stubs"],
    { modal: true },
  );
  if (choice !== "Create Stubs") {
    return;
  }

  const usedIds = collectRibbonIds(target.document);
  const baseSequence = nextCustomActionSequence(target.view);
  const inputs = commands.map((command, index) => {
    const ids = makeCustomButtonIds(
      target.document,
      target.view.scope,
      `${command.label} ${command.id}`,
    );
    const customActionId = nextBatchId(usedIds, ids.customActionId);
    const buttonId = nextBatchId(usedIds, ids.buttonId);
    const commandId = nextBatchId(usedIds, ids.commandId);
    const labelLocId = nextBatchId(usedIds, ids.labelLocId ?? `${buttonId}.Label`);
    const hideActionId = nextBatchId(
      usedIds,
      nextHideActionId(target.document, {
        hideActionId: makeHideActionId(
          target.document,
          target.view.scope,
          getOobControlId(command),
        ),
      }),
    );

    return {
      hideActionId,
      hideLocation: getOobControlId(command),
      customActionId,
      location,
      sequence: baseSequence + index * 10,
      buttonId,
      commandId,
      labelLocId,
      locLabel: {
        id: labelLocId,
        languageCode: 1033,
        description: command.label,
      },
    };
  });

  ctx.ribbon.editorState.queuePatches(
    target.document,
    createOobStubReplacementPatches(target.document, inputs),
  );
  ctx.ribbon.explorer.refresh();
}

export async function reorderOobRibbonButtons(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    await ctx.core.notifications.warning("Select a ribbon scope first.");
    return;
  }

  const location = await pickLocation(target.document, target.view.scope);
  if (!location) {
    return;
  }

  const commands = await pickOobCommandsForLocation(target.document, target.view, location, {
    placeHolder: "OOB buttons to reorder",
  });
  if (!commands?.length) {
    return;
  }

  const orderedCommands = await pickOobCommandOrder(commands);
  if (!orderedCommands) {
    return;
  }

  const choice = await ctx.core.notifications.askWarning(
    `Hide ${orderedCommands.length} OOB button${orderedCommands.length === 1 ? "" : "s"} and re-add them in the selected order?`,
    ["Reorder"],
    { modal: true },
  );
  if (choice !== "Reorder") {
    return;
  }

  const usedIds = collectRibbonIds(target.document);
  const baseSequence = nextCustomActionSequence(target.view);
  const inputs = orderedCommands.map((command, index) => {
    const ids = makeCustomButtonIds(
      target.document,
      target.view.scope,
      `${command.label} ${command.id}`,
    );
    const customActionId = nextBatchId(usedIds, ids.customActionId);
    const buttonId = nextBatchId(usedIds, ids.buttonId);
    const labelLocId = nextBatchId(usedIds, ids.labelLocId ?? `${buttonId}.Label`);
    const hideActionId = nextBatchId(
      usedIds,
      nextHideActionId(target.document, {
        hideActionId: makeHideActionId(
          target.document,
          target.view.scope,
          getOobControlId(command),
        ),
      }),
    );

    return {
      hideActionId,
      hideLocation: getOobControlId(command),
      customActionId,
      location,
      sequence: baseSequence + index * 10,
      buttonId,
      commandId: getOobCommandId(command),
      labelLocId,
      image16x16: command.image16x16,
      image32x32: command.image32x32,
      templateAlias: command.templateAlias,
      locLabel: {
        id: labelLocId,
        languageCode: 1033,
        description: command.label,
      },
    };
  });

  ctx.ribbon.editorState.queuePatches(
    target.document,
    createOobButtonReorderPatches(target.document, inputs),
  );
  ctx.ribbon.explorer.refresh();
}

export async function pickOobCommand(
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
  const pick = await showRibbonQuickPick<OobCommandPick>(items, {
    placeHolder: options.placeHolder ?? "OOB button command to hide",
  });

  if (!pick) {
    return undefined;
  }

  if (pick.command) {
    return pick.command;
  }

  const id = await showRibbonInputBox({
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
        commandId: id.trim(),
      }
    : undefined;
}

async function pickOobCommandsForLocation(
  document: RibbonDocument,
  view: RibbonView,
  location: string,
  options: { placeHolder?: string } = {},
): Promise<OobRibbonCommand[] | undefined> {
  const catalogLocation = listOobRibbonLocations(view.scope, document.entityLogicalName).find(
    (item) => item.location === location,
  );
  const commands = listOobRibbonCommands(view.scope, document.entityLogicalName);
  const suggested = catalogLocation
    ? commands.filter((command) => command.locationIds.includes(catalogLocation.id))
    : commands;
  const picks = await showRibbonQuickPick<OobCommandPick>(
    suggested.map((command) => ({
      label: command.id,
      description: command.label,
      command,
    })),
    {
      canPickMany: true,
      placeHolder: catalogLocation
        ? `OOB buttons in ${catalogLocation.label}`
        : (options.placeHolder ?? "OOB buttons to hide and stub"),
    },
  );

  return picks
    ?.map((pick) => pick.command)
    .filter((command): command is OobRibbonCommand => Boolean(command));
}

async function pickOobCommandOrder(
  commands: OobRibbonCommand[],
): Promise<OobRibbonCommand[] | undefined> {
  if (commands.length <= 1) {
    return commands;
  }

  const remaining = commands.slice();
  const ordered: OobRibbonCommand[] = [];

  while (remaining.length) {
    const pick = await showRibbonQuickPick<OobCommandPick>(
      remaining.map((command) => ({
        label: command.id,
        description: command.label,
        command,
      })),
      {
        placeHolder: `Pick button ${ordered.length + 1} of ${commands.length}`,
      },
    );
    if (!pick?.command) {
      return undefined;
    }

    ordered.push(pick.command);
    remaining.splice(
      remaining.findIndex((command) => command.id === pick.command?.id),
      1,
    );
  }

  return ordered;
}

export async function pickLocation(
  document: RibbonDocument,
  scope: RibbonScope | undefined,
  options: { command?: OobRibbonCommand; currentValue?: string } = {},
): Promise<string | undefined> {
  const suggestedLocations = (options.command?.locationIds ?? [])
    .map((id) => findOobRibbonLocation(id, document.entityLogicalName))
    .filter((location): location is NonNullable<typeof location> => !!location);
  const catalogLocations = listOobRibbonLocations(scope, document.entityLogicalName);
  const locations = suggestedLocations.length
    ? suggestedLocations
    : [...catalogLocations, ...listDocumentGroupLocations(document, scope, catalogLocations)];
  const commands = listOobRibbonCommands(scope, document.entityLogicalName);
  const pick = await showRibbonQuickPick<LocationPick>(
    [
      ...locations.map((location) => ({
        label: location.group,
        description: describeLocationContents(document, location, commands) || location.label,
        detail: location.location,
        location: location.location,
      })),
      { label: "Type location", description: "Use a custom location id", manual: true },
    ],
    { placeHolder: "Ribbon location", matchOnDescription: true, matchOnDetail: true },
  );

  if (!pick) {
    return undefined;
  }

  if (!pick.manual && pick.location) {
    return pick.location;
  }

  return showRibbonInputBox({
    prompt: "Ribbon location",
    value: options.currentValue,
    placeHolder: "Mscrm.Form.account.MainTab.Save.Controls._children",
    validateInput: (value) => (value.trim() ? undefined : "Location is required."),
  });
}

function describeLocationContents(
  document: RibbonDocument,
  location: OobRibbonLocation,
  commands: OobRibbonCommand[],
): string {
  const entries: Array<{ label: string; sequence?: number }> = [
    ...commands
      .filter((command) => command.locationIds.includes(location.id))
      .map((command) => ({ label: command.label, sequence: command.sequence })),
    ...listCustomButtonsAtLocation(document, location.location),
  ];
  const seen = new Set<string>();
  return entries
    .sort(
      (a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER),
    )
    .filter((entry) => {
      if (seen.has(entry.label)) {
        return false;
      }
      seen.add(entry.label);
      return true;
    })
    .map((entry) =>
      entry.sequence === undefined ? entry.label : `${entry.label} (${entry.sequence})`,
    )
    .join(", ");
}

function listDocumentGroupLocations(
  document: RibbonDocument,
  scope: RibbonScope | undefined,
  catalogLocations: OobRibbonLocation[],
): OobRibbonLocation[] {
  const known = new Set(catalogLocations.map((location) => location.location));
  const discovered = new Map<string, OobRibbonLocation>();
  for (const view of document.views) {
    for (const action of view.customActions) {
      const location = action.location;
      if (
        action.commandUI?.kind !== "Button" ||
        known.has(location) ||
        discovered.has(location) ||
        !isGroupChildrenLocation(location) ||
        !locationMatchesScope(location, scope)
      ) {
        continue;
      }

      const group = groupNameFromLocation(location) ?? location;
      discovered.set(location, {
        id: location,
        scope: inferRibbonScope(location) ?? scope ?? "Application",
        label: group,
        group,
        location,
      });
    }
  }

  return [...discovered.values()];
}

function isGroupChildrenLocation(location: string): boolean {
  return /\.Controls\._children$/.test(location);
}

function groupNameFromLocation(location: string): string | undefined {
  return /\.([^.]+)\.Controls\._children$/.exec(location)?.[1];
}

function locationMatchesScope(location: string, scope: RibbonScope | undefined): boolean {
  if (!scope || scope === "Application") {
    return true;
  }

  return inferRibbonScope(location) === scope;
}

function listCustomButtonsAtLocation(
  document: RibbonDocument,
  location: string,
): Array<{ label: string; sequence?: number }> {
  const buttons: Array<{ label: string; sequence?: number }> = [];
  for (const view of document.views) {
    for (const action of view.customActions) {
      const button = action.commandUI;
      if (action.location !== location || button?.kind !== "Button") {
        continue;
      }
      buttons.push({
        label: resolveCustomButtonLabel(document, button),
        sequence: action.sequence ?? button.sequence,
      });
    }
  }
  return buttons;
}

function resolveCustomButtonLabel(document: RibbonDocument, button: ButtonNode): string {
  const inline = button.labelText?.trim();
  if (inline) {
    return displayLabel(inline);
  }

  const locLabelId = button.labelLocId?.trim();
  if (locLabelId) {
    for (const view of document.views) {
      const title = view.locLabels
        .find((label) => label.id === locLabelId)
        ?.titles.find((item) => item.description.trim());
      if (title) {
        return title.description.trim();
      }
    }
  }

  return button.id;
}

function displayLabel(value: string): string {
  const reference = /^\$[A-Za-z]+:(.+)$/.exec(value);
  if (!reference) {
    return value;
  }

  const lastSegment = reference[1].split(".").pop()?.trim();
  return lastSegment || value;
}

async function pickHideLocation(
  document: RibbonDocument,
  view: RibbonView,
  command: OobRibbonCommand,
): Promise<string | undefined> {
  if (command.controlId) {
    return command.controlId;
  }

  return pickLocation(document, view.scope, { command });
}

export function getOobCommandId(command: OobRibbonCommand): string {
  return command.commandId || command.id;
}

function getOobControlId(command: OobRibbonCommand): string {
  return command.controlId || command.id;
}
