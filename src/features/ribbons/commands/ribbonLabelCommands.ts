import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { createLocLabelPatches, createLocLabelTitlePatch } from "../ribbonEditPatches";
import { RibbonExplorerNode } from "../ribbonExplorer";
import {
  resolveLocLabelTarget,
  resolveRibbonTarget,
  validateUniqueId,
} from "./ribbonCommandSupport";
import { promptRibbonLanguageCode } from "./ribbonLanguagePrompts";
import { showRibbonInputBox } from "./ribbonPromptUi";

export async function addRibbonLocLabel(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const id = await showRibbonInputBox({
    prompt: "Loc label id",
    placeHolder: `d365tools.${target.document.entityLogicalName ?? "application"}.${target.view.scope}.Label`,
    validateInput: (value) => validateUniqueId(target.document, value, "Label id is required."),
  });
  if (!id) {
    return;
  }

  const description = await showRibbonInputBox({
    prompt: "Text",
    placeHolder: "Validate and save",
    validateInput: (value) => (value.trim() ? undefined : "Text is required."),
  });
  if (!description) {
    return;
  }

  const languageCode = await promptRibbonLanguageCode();
  if (languageCode === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createLocLabelPatches(target.document, {
      id: id.trim(),
      languageCode,
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

  const languageCode = await promptRibbonLanguageCode({
    unavailableLanguageCodes: target.label.titles.map((title) => title.languageCode),
  });
  if (languageCode === undefined) {
    return;
  }

  const description = await showRibbonInputBox({
    prompt: "Text",
    placeHolder: "Validate and save",
    validateInput: (value) => (value.trim() ? undefined : "Text is required."),
  });
  if (description === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(target.document, [
    createLocLabelTitlePatch(target.document, target.label.range, {
      languageCode,
      description: description.trim(),
    }),
  ]);
  ctx.ribbonExplorer.refresh();
}
