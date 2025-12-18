import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";

export async function editConfiguration(ctx: CommandContext): Promise<void> {
  const { configuration } = ctx;
  const config = await configuration.loadConfiguration();
  await configuration.saveConfiguration(config);
  const uri = vscode.Uri.joinPath(
    vscode.Uri.file(configuration.workspaceRoot || "."),
    ".vscode",
    "dynamics365tools.config.json",
  );
  await vscode.window.showTextDocument(uri);
}
