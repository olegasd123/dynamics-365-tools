import * as vscode from "vscode";
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
    vscode.window.showWarningMessage("Select a ribbon scope first.");
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

  const commandId = getOobCommandId(command);
  const duplicate = validateUniqueId(target.document, commandId, "Command id is required.");
  if (duplicate) {
    vscode.window.showWarningMessage(`Cannot override '${commandId}': ${duplicate}`);
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Override OOB command '${commandId}'? This can replace default Dynamics behavior.`,
    { modal: true },
    "Override",
  );
  if (choice !== "Override") {
    return;
  }

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createCommandDefinitionPatches(target.document, {
      id: commandId,
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
