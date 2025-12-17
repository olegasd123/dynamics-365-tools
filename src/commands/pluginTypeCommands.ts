import * as vscode from "vscode";
import { pickEnvironmentAndAuth } from "./common";
import { ConfigurationService } from "../services/configurationService";
import { SolutionService } from "../services/solutionService";
import { SecretService } from "../services/secretService";
import { AuthService } from "../services/authService";
import { LastSelectionService } from "../services/lastSelectionService";
import { EnvironmentConnectionService } from "../services/environmentConnectionService";
import { PluginExplorerProvider, PluginTypeNode } from "../plugins/pluginExplorer";
import { DataverseClient } from "../services/dataverseClient";
import { SolutionComponentService } from "../services/solutionComponentService";
import { PluginService } from "../plugins/pluginService";

export async function deletePluginType(
  configuration: ConfigurationService,
  ui: SolutionService,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  connections: EnvironmentConnectionService,
  explorer: PluginExplorerProvider,
  node?: PluginTypeNode,
): Promise<void> {
  if (!node) {
    void vscode.window.showInformationMessage(
      "Run this command from a plugin in the Plugins explorer.",
    );
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Remove plugin '${node.pluginType.friendlyName ?? node.pluginType.name}' from ${node.env.name}? All steps and images will also be removed.`,
    { modal: true },
    "Delete",
  );
  if (confirmation !== "Delete") {
    return;
  }

  const service = await resolvePluginService(
    "Select environment to delete plugin",
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    node.env.name,
  );
  if (!service) {
    return;
  }

  try {
    await service.deletePluginTypeCascade(node.pluginType.id);
    explorer.refresh();
    void vscode.window.showInformationMessage(`Plugin ${node.pluginType.name} removed.`);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to remove plugin ${node.pluginType.name}: ${String(error)}`,
    );
  }
}

async function resolvePluginService(
  placeHolder: string,
  configuration: ConfigurationService,
  ui: SolutionService,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  connections: EnvironmentConnectionService,
  preferredEnv: string,
): Promise<PluginService | undefined> {
  const config = await configuration.loadConfiguration();
  const selection = await pickEnvironmentAndAuth(
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    config,
    preferredEnv,
    { placeHolder },
  );
  if (!selection) return undefined;

  const connection = await connections.createConnection(selection.env, selection.auth);
  if (!connection) return undefined;

  const client = new DataverseClient(connection);
  const solutionComponents = new SolutionComponentService(client);
  return new PluginService(client, solutionComponents);
}
