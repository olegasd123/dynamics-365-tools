import * as vscode from "vscode";
import { pickEnvironmentAndAuth } from "../../../platform/vscode/commandUtils";
import { CommandContext } from "../../../app/commandContext";
import { ConfigurationService } from "../../config/configurationService";
import { SolutionPicker } from "../../../platform/vscode/ui/solutionPicker";
import { SecretService } from "../../auth/secretService";
import { AuthService } from "../../auth/authService";
import { LastSelectionService } from "../../../platform/vscode/lastSelectionStore";
import { EnvironmentConnectionService } from "../../dataverse/environmentConnectionService";
import { PluginTypeNode } from "../pluginExplorer";
import { DataverseClient } from "../../dataverse/dataverseClient";
import { SolutionComponentService } from "../../dataverse/solutionComponentService";
import { PluginService } from "../pluginService";

export async function deletePluginType(ctx: CommandContext, node?: PluginTypeNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, pluginExplorer } = ctx;
  const explorer = pluginExplorer;
  if (!node) {
    void vscode.window.showInformationMessage(
      "Run this command from a plugin in the Plugins explorer.",
    );
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Remove plugin '${node.pluginType.name}' from ${node.env.name}? All steps and images will also be removed.`,
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
  ui: SolutionPicker,
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
