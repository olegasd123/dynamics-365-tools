import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { RibbonDocumentNode } from "../ribbonExplorer";

export function refreshRibbonExplorer(ctx: CommandContext): void {
  ctx.ribbonExplorer.refresh();
}

export async function openRibbonFile(node?: RibbonDocumentNode): Promise<void> {
  if (!(node instanceof RibbonDocumentNode)) {
    vscode.window.showWarningMessage("Select a ribbon document first.");
    return;
  }

  await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(node.document.fileUri));
}
