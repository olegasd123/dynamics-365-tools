import * as vscode from "vscode";
import { CommandContext } from "@app/commandContext";
import {
  createCustomButtonPatches,
  createHideActionPatches,
  createOobButtonReorderPatches,
  createOobStubReplacementPatches,
  makeCustomButtonIds,
  makeHideActionId,
  nextHideActionId,
} from "../ribbonEditPatches";
import { RibbonExplorerNode } from "../ribbonExplorer";
import { RibbonDocument, RibbonView } from "../models";
import {
  findOobRibbonLocation,
  listOobRibbonCommands,
  listOobRibbonLocations,
  OobRibbonCommand,
} from "../oobCatalog";
import {
  promptJavaScriptAction,
  promptUrlAction,
  validateOptionalNumber,
} from "./ribbonActionPrompts";
import {
  collectRibbonIds,
  nextBatchId,
  nextCustomActionSequence,
  resolveRibbonTarget,
} from "./ribbonCommandSupport";
import { showRibbonInputBox, showRibbonQuickPick } from "./ribbonPromptUi";
import { pickImageWebResource } from "./ribbonResourcePrompts";

interface OobCommandPick extends vscode.QuickPickItem {
  command?: OobRibbonCommand;
  manual?: boolean;
}

export async function addCustomRibbonButton(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
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
    value: String(nextCustomActionSequence(target.view)),
    validateInput: validateOptionalNumber,
  });
  if (sequenceText === undefined) {
    return;
  }

  const location = await pickLocation(target.document, target.view);
  if (!location) {
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
  const action =
    actionKind.label === "URL" ? await promptUrlAction() : await promptJavaScriptAction(ctx);
  if (!action) {
    return;
  }

  ctx.ribbon.editorState.queuePatches(
    target.document,
    createCustomButtonPatches(target.document, {
      ...ids,
      location,
      action,
      sequence: sequenceText.trim() ? Number(sequenceText.trim()) : undefined,
      labelLocId,
      alt: alt.trim() || undefined,
      toolTipTitle: toolTipTitle.trim() || undefined,
      toolTipDescription: toolTipDescription.trim() || undefined,
      image16x16: image16x16?.trim() || undefined,
      image32x32: image32x32?.trim() || undefined,
      modernImage: modernImage.trim() || undefined,
      templateAlias: "o1",
      locLabel: {
        id: labelLocId,
        languageCode: 1033,
        description: labelValue,
      },
    }),
  );
  ctx.ribbon.explorer.refresh();
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

  const location = await pickLocation(target.document, target.view);
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

  const location = await pickLocation(target.document, target.view);
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
  const pick = await showRibbonQuickPick(
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

  return showRibbonInputBox({
    prompt: "Ribbon location",
    placeHolder: "Mscrm.Form.account.MainTab.Save.Controls._children",
    validateInput: (value) => (value.trim() ? undefined : "Location is required."),
  });
}

async function pickHideLocation(
  document: RibbonDocument,
  view: RibbonView,
  command: OobRibbonCommand,
): Promise<string | undefined> {
  if (command.controlId) {
    return command.controlId;
  }

  return pickLocation(document, view, command);
}

export function getOobCommandId(command: OobRibbonCommand): string {
  return command.commandId || command.id;
}

function getOobControlId(command: OobRibbonCommand): string {
  return command.controlId || command.id;
}
