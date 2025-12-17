import * as vscode from "vscode";
import { pickEnvironmentAndAuth } from "./common";
import { ConfigurationService } from "../services/configurationService";
import { SolutionService } from "../services/solutionService";
import { SecretService } from "../services/secretService";
import { AuthService } from "../services/authService";
import { LastSelectionService } from "../services/lastSelectionService";
import { EnvironmentConnectionService } from "../services/environmentConnectionService";
import {
  PluginExplorerProvider,
  PluginImageNode,
  PluginStepNode,
  PluginTypeNode,
} from "../plugins/pluginExplorer";
import { DataverseClient } from "../services/dataverseClient";
import { SolutionComponentService } from "../services/solutionComponentService";
import { PluginService } from "../plugins/pluginService";

export async function createPluginStep(
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
      "Run this command from a plugin type in the Plugins explorer.",
    );
    return;
  }

  const service = await resolveServiceForNode(
    "Select environment to create a plugin step",
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    node.env.name,
  );
  if (!service) return;

  const messageName = await vscode.window.showInputBox({
    prompt: "Message name (e.g. Create, Update, Delete)",
    value: "Create",
    ignoreFocusOut: true,
  });
  if (!messageName) return;

  const primaryEntity = await vscode.window.showInputBox({
    prompt: "Primary entity logical name (leave blank for global message)",
    placeHolder: "account",
    ignoreFocusOut: true,
  });

  const stage = await pickStage();
  if (stage === undefined) return;

  const mode = await pickMode();
  if (mode === undefined) return;

  const rankValue = await vscode.window.showInputBox({
    prompt: "Execution rank (lower runs first)",
    value: "1",
    validateInput: (val) => (Number.isNaN(Number(val)) ? "Enter a number" : undefined),
    ignoreFocusOut: true,
  });
  if (rankValue === undefined) return;
  const rank = Number(rankValue) || 1;

  const filteringAttributes = await vscode.window.showInputBox({
    prompt: "Filtering attributes (comma-separated, optional)",
    placeHolder: "name,emailaddress1",
    ignoreFocusOut: true,
  });

  const defaultName = buildStepDefaultName(node.pluginType.name, messageName, primaryEntity);
  const name = await vscode.window.showInputBox({
    prompt: "Step name",
    value: defaultName,
    ignoreFocusOut: true,
  });
  if (!name) return;

  try {
    await service.createStep(node.pluginType.id, {
      name,
      messageName,
      primaryEntity: primaryEntity || undefined,
      stage,
      mode,
      rank,
      filteringAttributes: filteringAttributes ?? "",
    });
    explorer.refresh(node);
    void vscode.window.showInformationMessage(`Plugin step ${name} created.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to create plugin step: ${String(error)}`);
  }
}

export async function editPluginStep(
  configuration: ConfigurationService,
  ui: SolutionService,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  connections: EnvironmentConnectionService,
  explorer: PluginExplorerProvider,
  node?: PluginStepNode,
): Promise<void> {
  if (!node) {
    void vscode.window.showInformationMessage(
      "Run this command from a plugin step in the Plugins explorer.",
    );
    return;
  }

  const service = await resolveServiceForNode(
    "Select environment to edit a plugin step",
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    node.env.name,
  );
  if (!service) return;

  const messageName = await vscode.window.showInputBox({
    prompt: "Message name",
    value: node.step.messageName ?? "Create",
    ignoreFocusOut: true,
  });
  if (!messageName) return;

  const primaryEntity = await vscode.window.showInputBox({
    prompt: "Primary entity logical name (leave blank for global message)",
    value: node.step.primaryEntity ?? "",
    ignoreFocusOut: true,
  });

  const stage = await pickStage(node.step.stage);
  if (stage === undefined) return;

  const mode = await pickMode(node.step.mode);
  if (mode === undefined) return;

  const rankValue = await vscode.window.showInputBox({
    prompt: "Execution rank (lower runs first)",
    value: String(node.step.rank ?? 1),
    validateInput: (val) => (Number.isNaN(Number(val)) ? "Enter a number" : undefined),
    ignoreFocusOut: true,
  });
  if (rankValue === undefined) return;
  const rank = Number(rankValue) || 1;

  const filteringAttributes = await vscode.window.showInputBox({
    prompt: "Filtering attributes (comma-separated, optional)",
    value: node.step.filteringAttributes ?? "",
    ignoreFocusOut: true,
  });

  const name = await vscode.window.showInputBox({
    prompt: "Step name",
    value: node.step.name,
    ignoreFocusOut: true,
  });
  if (!name) return;

  try {
    await service.updateStep(node.step.id, {
      name,
      messageName,
      primaryEntity: primaryEntity || undefined,
      stage,
      mode,
      rank,
      filteringAttributes: filteringAttributes ?? "",
    });
    explorer.refresh(node);
    void vscode.window.showInformationMessage(`Plugin step ${name} updated.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to update plugin step: ${String(error)}`);
  }
}

export async function deletePluginStep(
  configuration: ConfigurationService,
  ui: SolutionService,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  connections: EnvironmentConnectionService,
  explorer: PluginExplorerProvider,
  node?: PluginStepNode,
): Promise<void> {
  if (!node) {
    void vscode.window.showInformationMessage(
      "Run this command from a plugin step in the Plugins explorer.",
    );
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Delete plugin step '${node.step.name}'?`,
    { modal: true },
    "Delete",
  );
  if (confirmed !== "Delete") return;

  const service = await resolveServiceForNode(
    "Select environment to delete a plugin step",
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    node.env.name,
  );
  if (!service) return;

  try {
    await service.deleteStep(node.step.id);
    explorer.refresh(node);
    void vscode.window.showInformationMessage(`Plugin step ${node.step.name} deleted.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to delete plugin step: ${String(error)}`);
  }
}

export async function createPluginImage(
  configuration: ConfigurationService,
  ui: SolutionService,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  connections: EnvironmentConnectionService,
  explorer: PluginExplorerProvider,
  node?: PluginStepNode,
): Promise<void> {
  if (!node) {
    void vscode.window.showInformationMessage(
      "Run this command from a plugin step in the Plugins explorer.",
    );
    return;
  }

  const service = await resolveServiceForNode(
    "Select environment to create a plugin image",
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    node.env.name,
  );
  if (!service) return;

  const type = await pickImageType();
  if (type === undefined) return;

  const entityAlias = await vscode.window.showInputBox({
    prompt: "Image entity alias",
    value: type === 0 ? "PreImage" : type === 1 ? "PostImage" : "Image",
    ignoreFocusOut: true,
  });
  if (!entityAlias) return;

  const messagePropertyName = await vscode.window.showInputBox({
    prompt: "Message property name",
    value: "Target",
    ignoreFocusOut: true,
  });
  if (!messagePropertyName) return;

  const attributes = await vscode.window.showInputBox({
    prompt: "Attributes (comma-separated, optional)",
    placeHolder: "name,emailaddress1",
    ignoreFocusOut: true,
  });

  const name = await vscode.window.showInputBox({
    prompt: "Image name",
    value: entityAlias,
    ignoreFocusOut: true,
  });
  if (!name) return;

  try {
    await service.createImage(node.step.id, {
      name,
      type,
      entityAlias,
      messagePropertyName,
      attributes: attributes ?? "",
    });
    explorer.refresh(node);
    void vscode.window.showInformationMessage(`Plugin image ${name} created.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to create plugin image: ${String(error)}`);
  }
}

export async function editPluginImage(
  configuration: ConfigurationService,
  ui: SolutionService,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  connections: EnvironmentConnectionService,
  explorer: PluginExplorerProvider,
  node?: PluginImageNode,
): Promise<void> {
  if (!node) {
    void vscode.window.showInformationMessage(
      "Run this command from a plugin image in the Plugins explorer.",
    );
    return;
  }

  const service = await resolveServiceForNode(
    "Select environment to edit a plugin image",
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    node.env.name,
  );
  if (!service) return;

  const type = await pickImageType(node.image.type);
  if (type === undefined) return;

  const entityAlias = await vscode.window.showInputBox({
    prompt: "Image entity alias",
    value: node.image.entityAlias ?? "Image",
    ignoreFocusOut: true,
  });
  if (!entityAlias) return;

  const messagePropertyName = await vscode.window.showInputBox({
    prompt: "Message property name",
    value: node.image.messagePropertyName ?? "Target",
    ignoreFocusOut: true,
  });
  if (!messagePropertyName) return;

  const attributes = await vscode.window.showInputBox({
    prompt: "Attributes (comma-separated, optional)",
    value: node.image.attributes ?? "",
    ignoreFocusOut: true,
  });

  const name = await vscode.window.showInputBox({
    prompt: "Image name",
    value: node.image.name,
    ignoreFocusOut: true,
  });
  if (!name) return;

  try {
    await service.updateImage(node.image.id, {
      name,
      type,
      entityAlias,
      messagePropertyName,
      attributes: attributes ?? "",
    });
    explorer.refresh(node);
    void vscode.window.showInformationMessage(`Plugin image ${name} updated.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to update plugin image: ${String(error)}`);
  }
}

export async function deletePluginImage(
  configuration: ConfigurationService,
  ui: SolutionService,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  connections: EnvironmentConnectionService,
  explorer: PluginExplorerProvider,
  node?: PluginImageNode,
): Promise<void> {
  if (!node) {
    void vscode.window.showInformationMessage(
      "Run this command from a plugin image in the Plugins explorer.",
    );
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Delete plugin image '${node.image.name}'?`,
    { modal: true },
    "Delete",
  );
  if (confirmed !== "Delete") return;

  const service = await resolveServiceForNode(
    "Select environment to delete a plugin image",
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    node.env.name,
  );
  if (!service) return;

  try {
    await service.deleteImage(node.image.id);
    explorer.refresh(node);
    void vscode.window.showInformationMessage(`Plugin image ${node.image.name} deleted.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to delete plugin image: ${String(error)}`);
  }
}

async function resolveServiceForNode(
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

function buildStepDefaultName(
  typeName: string,
  message: string,
  entity: string | undefined,
): string {
  const entityLabel = entity || "global";
  return `(Step) ${typeName}: ${message} of ${entityLabel}`;
}

async function pickStage(defaultStage?: number): Promise<number | undefined> {
  const options = [
    { label: "Pre-validation", description: "Before pipeline", value: 10 },
    { label: "Pre-operation", description: "Before core operation", value: 20 },
    { label: "Post-operation", description: "After core operation", value: 40 },
  ];
  const pick = await vscode.window.showQuickPick(
    options.map((o) => ({
      label: o.label,
      description: o.description,
      value: o.value,
      picked: o.value === defaultStage,
    })),
    { placeHolder: "Select pipeline stage" },
  );
  return pick?.value;
}

async function pickMode(defaultMode?: number): Promise<number | undefined> {
  const options = [
    { label: "Synchronous", description: "Runs in pipeline", value: 0 },
    { label: "Asynchronous", description: "Background", value: 1 },
  ];
  const pick = await vscode.window.showQuickPick(
    options.map((o) => ({
      label: o.label,
      description: o.description,
      value: o.value,
      picked: o.value === defaultMode,
    })),
    { placeHolder: "Select execution mode" },
  );
  return pick?.value;
}

async function pickImageType(defaultType?: number): Promise<number | undefined> {
  const options = [
    { label: "Pre-image", value: 0 },
    { label: "Post-image", value: 1 },
    { label: "Both", value: 2 },
  ];
  const pick = await vscode.window.showQuickPick(
    options.map((o) => ({ label: o.label, value: o.value, picked: o.value === defaultType })),
    { placeHolder: "Select image type" },
  );
  return pick?.value;
}
