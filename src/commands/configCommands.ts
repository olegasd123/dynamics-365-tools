import * as vscode from "vscode";
import { ConfigurationService } from "../services/configurationService";

export async function editConfiguration(configuration: ConfigurationService): Promise<void> {
  const config = await configuration.loadConfiguration();
  await configuration.saveConfiguration(config);
  const uri = vscode.Uri.joinPath(
    vscode.Uri.file(configuration.workspaceRoot || "."),
    ".vscode",
    "dynamics365tools.config.json",
  );
  await vscode.window.showTextDocument(uri);
}
