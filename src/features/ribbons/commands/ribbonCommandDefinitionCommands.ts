import { CommandContext } from "../../../app/commandContext";
import { createCommandActionPatch, createCommandDefinitionPatches } from "../ribbonEditPatches";
import { RibbonExplorerNode } from "../ribbonExplorer";
import { promptCommandAction, promptOptionalCommandAction } from "./ribbonActionPrompts";
import { getOobCommandId, pickOobCommand } from "./ribbonButtonCommands";
import {
  resolveCommandTarget,
  resolveRibbonTarget,
  validateUniqueId,
} from "./ribbonCommandSupport";
import { showRibbonInputBox } from "./ribbonPromptUi";

export async function addRibbonCommandDefinition(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    await ctx.core.notifications.warning("Select a ribbon scope first.");
    return;
  }

  const id = await showRibbonInputBox({
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

  ctx.ribbon.editorState.queuePatches(
    target.document,
    createCommandDefinitionPatches(target.document, {
      id: id.trim(),
      action: action ?? undefined,
    }),
  );
  ctx.ribbon.explorer.refresh();
}

export async function overrideOobRibbonCommand(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    await ctx.core.notifications.warning("Select a ribbon scope first.");
    return;
  }

  const command = await pickOobCommand(target.document, target.view, {
    placeHolder: "OOB command to override",
    manualDescription: "Use a custom OOB command id",
  });
  if (!command) {
    return;
  }

  const commandId = getOobCommandId(command);
  const duplicate = validateUniqueId(target.document, commandId, "Command id is required.");
  if (duplicate) {
    await ctx.core.notifications.warning(`Cannot override '${commandId}': ${duplicate}`);
    return;
  }

  const choice = await ctx.core.notifications.askWarning(
    `Override OOB command '${commandId}'? This can replace default Dynamics behavior.`,
    ["Override"],
    { modal: true },
  );
  if (choice !== "Override") {
    return;
  }

  ctx.ribbon.editorState.queuePatches(
    target.document,
    createCommandDefinitionPatches(target.document, {
      id: commandId,
    }),
  );
  ctx.ribbon.explorer.refresh();
}

export async function addRibbonCommandAction(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveCommandTarget(node);
  if (!target) {
    await ctx.core.notifications.warning("Select a command definition first.");
    return;
  }

  const action = await promptCommandAction(ctx);
  if (!action) {
    return;
  }

  ctx.ribbon.editorState.queuePatches(target.document, [
    createCommandActionPatch(target.document, target.command, action),
  ]);
  ctx.ribbon.explorer.refresh();
}
