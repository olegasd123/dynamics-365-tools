import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { PcfControlProjectNode } from "../pcfExplorer";

export async function refreshPcfExplorer(ctx: CommandContext): Promise<void> {
  await ctx.pcfProjectLocator.refresh();
  ctx.pcfExplorer.refresh();
}

export async function openPcfManifest(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): Promise<void> {
  const uri = resolveManifestUri(ctx, nodeOrUri);
  if (!uri) {
    void vscode.window.showWarningMessage("Select a PCF control manifest first.");
    return;
  }

  await vscode.window.showTextDocument(uri);
}

function resolveManifestUri(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): vscode.Uri | undefined {
  if (nodeOrUri instanceof PcfControlProjectNode) {
    return vscode.Uri.file(nodeOrUri.project.manifestUri);
  }

  if (nodeOrUri instanceof vscode.Uri) {
    return nodeOrUri;
  }

  const editorUri = vscode.window.activeTextEditor?.document.uri;
  if (editorUri?.fsPath.endsWith("ControlManifest.Input.xml")) {
    return editorUri;
  }

  const firstProject = ctx.pcfProjectLocator.getProjects()[0];
  return firstProject ? vscode.Uri.file(firstProject.manifestUri) : undefined;
}
