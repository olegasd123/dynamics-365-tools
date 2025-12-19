import * as vscode from "vscode";
import { pickEnvironmentAndAuth } from "../../../platform/vscode/commandUtils";
import { CommandContext } from "../../../app/commandContext";
import { ConfigurationService } from "../../config/configurationService";
import { SolutionPicker } from "../../../platform/vscode/ui/solutionPicker";
import { SecretService } from "../../auth/secretService";
import { AuthService } from "../../auth/authService";
import { LastSelectionService } from "../../../platform/vscode/lastSelectionStore";
import { EnvironmentConnectionService } from "../../dataverse/environmentConnectionService";
import { Dynamics365Configuration } from "../../config/domain/models";
import {
  PluginExplorerProvider,
  PluginImageNode,
  PluginStepNode,
  PluginTypeNode,
} from "../pluginExplorer";
import { DataverseClient } from "../../dataverse/dataverseClient";
import { SolutionComponentService } from "../../dataverse/solutionComponentService";
import { PluginService } from "../pluginService";
import { PluginStep } from "../models";

export async function createPluginStep(ctx: CommandContext, node?: PluginTypeNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, pluginExplorer } = ctx;
  const explorer = pluginExplorer;
  const config = await configuration.loadConfiguration();
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
    config,
  );
  if (!service) return;

  const messageName = await pickMessageName(service);
  if (!messageName) return;

  const primaryEntityPick = await pickPrimaryEntity(service);
  if (primaryEntityPick.cancelled) return;
  const primaryEntity = primaryEntityPick.value;

  const filteringAttributesPick = await pickFilteringAttributes(
    service,
    primaryEntity ?? undefined,
  );
  if (filteringAttributesPick.cancelled) return;
  const filteringAttributes = filteringAttributesPick.value;

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

  const defaultName = buildStepDefaultName(node.pluginType.name, messageName, primaryEntity);
  const name = await vscode.window.showInputBox({
    prompt: "Step name",
    value: defaultName,
    ignoreFocusOut: true,
  });
  if (!name) return;

  const solution = await ui.promptSolution(config.solutions);
  if (!solution) return;

  try {
    await service.createStep(node.pluginType.id, {
      name,
      messageName,
      primaryEntity: primaryEntity || undefined,
      stage,
      mode,
      rank,
      filteringAttributes: filteringAttributes ?? "",
      solutionName: solution.name,
    });
    explorer.refresh();
    void vscode.window.showInformationMessage(`Plugin step ${name} created.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to create plugin step: ${String(error)}`);
  }
}

export async function editPluginStep(ctx: CommandContext, node?: PluginStepNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, pluginExplorer } = ctx;
  const explorer = pluginExplorer;
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

  const messageName = await pickMessageName(service, node.step.messageName ?? "Create");
  if (!messageName) return;

  const primaryEntityPick = await pickPrimaryEntity(service, node.step.primaryEntity);
  if (primaryEntityPick.cancelled) return;
  const primaryEntity = primaryEntityPick.value;

  const filteringAttributesPick = await pickFilteringAttributes(
    service,
    primaryEntity ?? undefined,
    node.step.filteringAttributes ?? "",
  );
  if (filteringAttributesPick.cancelled) return;
  const filteringAttributes = filteringAttributesPick.value;

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
    explorer.refresh();
    void vscode.window.showInformationMessage(`Plugin step ${name} updated.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to update plugin step: ${String(error)}`);
  }
}

export async function enablePluginStep(ctx: CommandContext, node?: PluginStepNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, pluginExplorer } = ctx;
  await setPluginStepState(
    {
      action: "enable",
      confirmation: undefined,
      successMessage: (name) => `Plugin step ${name} enabled.`,
      placeHolder: "Select environment to enable a plugin step",
    },
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    pluginExplorer,
    node,
    true,
  );
}

export async function disablePluginStep(ctx: CommandContext, node?: PluginStepNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, pluginExplorer } = ctx;
  await setPluginStepState(
    {
      action: "disable",
      confirmation: "Disable",
      successMessage: (name) => `Plugin step ${name} disabled.`,
      placeHolder: "Select environment to disable a plugin step",
    },
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    pluginExplorer,
    node,
    false,
  );
}

export async function deletePluginStep(ctx: CommandContext, node?: PluginStepNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, pluginExplorer } = ctx;
  const explorer = pluginExplorer;
  if (!node) {
    void vscode.window.showInformationMessage(
      "Run this command from a plugin step in the Plugins explorer.",
    );
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Delete plugin '${node.step.name}' step from ${node.env.name}?`,
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
    explorer.refresh();
    void vscode.window.showInformationMessage(`Plugin ${node.step.name} step deleted.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to delete plugin step: ${String(error)}`);
  }
}

export async function createPluginImage(ctx: CommandContext, node?: PluginStepNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, pluginExplorer } = ctx;
  const explorer = pluginExplorer;
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
    value: getDefaultMessagePropertyName(node.step),
    ignoreFocusOut: true,
  });
  if (!messagePropertyName) return;

  const attributesPick = await pickFilteringAttributes(
    service,
    node.step.primaryEntity ?? undefined,
  );
  if (attributesPick.cancelled) return;
  const attributes = attributesPick.value;

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
    explorer.refresh();
    void vscode.window.showInformationMessage(`Plugin image ${name} created.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to create plugin image: ${String(error)}`);
  }
}

export async function editPluginImage(ctx: CommandContext, node?: PluginImageNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, pluginExplorer } = ctx;
  const explorer = pluginExplorer;
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
    value: node.image.messagePropertyName ?? getDefaultMessagePropertyName(node.step),
    ignoreFocusOut: true,
  });
  if (!messagePropertyName) return;

  const attributesPick = await pickFilteringAttributes(
    service,
    node.step.primaryEntity ?? undefined,
    node.image.attributes ?? "",
  );
  if (attributesPick.cancelled) return;
  const attributes = attributesPick.value;

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
    explorer.refresh();
    void vscode.window.showInformationMessage(`Plugin image ${name} updated.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to update plugin image: ${String(error)}`);
  }
}

export async function deletePluginImage(
  ctx: CommandContext,
  node?: PluginImageNode,
): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, pluginExplorer } = ctx;
  const explorer = pluginExplorer;
  if (!node) {
    void vscode.window.showInformationMessage(
      "Run this command from a plugin image in the Plugins explorer.",
    );
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Delete plugin '${node.image.name}' image from ${node.env.name}?`,
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
    explorer.refresh();
    void vscode.window.showInformationMessage(`Plugin ${node.image.name} image deleted.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to delete plugin image: ${String(error)}`);
  }
}

async function resolveServiceForNode(
  placeHolder: string,
  configuration: ConfigurationService,
  ui: SolutionPicker,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  connections: EnvironmentConnectionService,
  preferredEnv: string,
  config?: Dynamics365Configuration,
): Promise<PluginService | undefined> {
  const resolvedConfig = config ?? (await configuration.loadConfiguration());
  const selection = await pickEnvironmentAndAuth(
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    resolvedConfig,
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

type MessagePickItem = vscode.QuickPickItem & { isCustom?: boolean };

type PrimaryEntityPick = { value?: string; cancelled: boolean };
type PrimaryEntityPickItem = vscode.QuickPickItem & { type: "entity" | "custom" | "none" };
type FilteringAttributesPick = { value?: string; cancelled: boolean };
type FilteringPickItem = vscode.QuickPickItem & { pickType: "attribute" | "custom" };

async function pickMessageName(
  service: PluginService,
  defaultValue = "Create",
): Promise<string | undefined> {
  let messageNames: string[] = [];
  try {
    messageNames = await service.listSdkMessageNames();
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Unable to load SDK messages. Enter a message name manually. ${String(error)}`,
    );
    return promptForMessageName(defaultValue);
  }

  if (!messageNames.length) {
    return promptForMessageName(defaultValue);
  }

  const deduped = Array.from(new Set(messageNames));
  const items: MessagePickItem[] = deduped.map((name) => ({
    label: name,
    picked: name === defaultValue,
  }));

  if (defaultValue && !deduped.includes(defaultValue)) {
    items.unshift({
      label: defaultValue,
      description: "Current value",
      picked: true,
    });
  }

  items.unshift({
    label: "Enter custom message name...",
    description: "Type a message name manually",
    isCustom: true,
  });

  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: "Select SDK message name",
    matchOnDescription: true,
    ignoreFocusOut: true,
  });

  if (!selection) return undefined;
  if ((selection as MessagePickItem).isCustom) {
    return promptForMessageName(defaultValue);
  }

  return selection.label;
}

async function promptForMessageName(defaultValue: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: "Message name",
    value: defaultValue,
    ignoreFocusOut: true,
  });
}

async function pickPrimaryEntity(
  service: PluginService,
  defaultValue?: string,
): Promise<PrimaryEntityPick> {
  let entities: string[] = [];
  try {
    entities = await service.listEntityLogicalNames();
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Unable to load entities. Enter a logical name manually. ${String(error)}`,
    );
    return promptForPrimaryEntity(defaultValue);
  }

  if (!entities.length) {
    return promptForPrimaryEntity(defaultValue);
  }

  const deduped = Array.from(new Set(entities)).sort((a, b) => a.localeCompare(b));
  const items: PrimaryEntityPickItem[] = [
    {
      label: "Global message (no primary entity)",
      description: "Use for messages without a primary entity",
      type: "none",
      picked: !defaultValue,
    },
    ...deduped.map((name) => ({
      label: name,
      type: "entity" as const,
      picked: name === defaultValue,
    })),
  ];

  if (defaultValue && !deduped.includes(defaultValue)) {
    items.splice(1, 0, {
      label: defaultValue,
      description: "Current value",
      type: "entity",
      picked: true,
    });
  }

  items.push({
    label: "Enter custom logical name...",
    description: "Type a logical name manually",
    type: "custom",
  });

  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: "Select primary entity or choose global message",
    matchOnDescription: true,
    ignoreFocusOut: true,
  });

  if (!selection) return { value: undefined, cancelled: true };

  const type = (selection as PrimaryEntityPickItem).type;
  if (type === "none") return { value: undefined, cancelled: false };
  if (type === "custom") return promptForPrimaryEntity(defaultValue);

  return { value: selection.label, cancelled: false };
}

async function promptForPrimaryEntity(defaultValue?: string): Promise<PrimaryEntityPick> {
  const value = await vscode.window.showInputBox({
    prompt: "Primary entity logical name (leave blank for global message)",
    placeHolder: "account",
    value: defaultValue ?? "",
    ignoreFocusOut: true,
  });
  if (value === undefined) {
    return { value: undefined, cancelled: true };
  }
  const trimmed = value.trim();
  return { value: trimmed || undefined, cancelled: false };
}

async function pickFilteringAttributes(
  service: PluginService,
  primaryEntity?: string,
  defaultValue?: string,
): Promise<FilteringAttributesPick> {
  if (!primaryEntity) {
    return promptForFilteringAttributes(defaultValue);
  }

  let attributes: string[] = [];
  try {
    attributes = await service.listEntityAttributeLogicalNames(primaryEntity);
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Unable to load attributes. Enter them manually. ${String(error)}`,
    );
    return promptForFilteringAttributes(defaultValue);
  }

  if (!attributes.length) {
    return promptForFilteringAttributes(defaultValue);
  }

  const defaults = parseFilteringAttributes(defaultValue);
  const items: FilteringPickItem[] = attributes
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map((attr) => ({
      label: attr,
      pickType: "attribute" as const,
      picked: defaults.has(attr),
    }));

  items.unshift({
    label: "Enter custom list...",
    description: "Type attributes manually",
    pickType: "custom",
  });

  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: "Select filtering attributes",
    matchOnDescription: true,
    canPickMany: true,
    ignoreFocusOut: true,
  });

  if (!selection) return { value: defaultValue, cancelled: true };

  if (selection.some((item) => (item as FilteringPickItem).pickType === "custom")) {
    return promptForFilteringAttributes(defaultValue);
  }

  const chosen = selection
    .filter((item) => (item as FilteringPickItem).pickType === "attribute")
    .map((item) => item.label)
    .filter(Boolean);
  return { value: chosen.join(","), cancelled: false };
}

async function promptForFilteringAttributes(
  defaultValue?: string,
): Promise<FilteringAttributesPick> {
  const value = await vscode.window.showInputBox({
    prompt: "Filtering attributes (comma-separated, optional)",
    placeHolder: "name,emailaddress1",
    value: defaultValue ?? "",
    ignoreFocusOut: true,
  });
  if (value === undefined) {
    return { value: undefined, cancelled: true };
  }
  const trimmed = value.trim();
  return { value: trimmed || undefined, cancelled: false };
}

function parseFilteringAttributes(value?: string): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
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

function getDefaultMessagePropertyName(step: PluginStep): string {
  const message = step.messageName?.toLowerCase();
  if (message === "create") {
    return "Id";
  }
  return "Target";
}

async function setPluginStepState(
  options: {
    action: string;
    confirmation?: "Disable";
    successMessage: (name: string) => string;
    placeHolder: string;
  },
  configuration: ConfigurationService,
  ui: SolutionPicker,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  connections: EnvironmentConnectionService,
  explorer: PluginExplorerProvider,
  node: PluginStepNode | undefined,
  enabled: boolean,
): Promise<void> {
  if (!node) {
    void vscode.window.showInformationMessage(
      `Run this command from a plugin step in the Plugins explorer to ${options.action} it.`,
    );
    return;
  }

  if (node.step.status !== undefined) {
    const isEnabled = node.step.status === 0;
    if (isEnabled === enabled) {
      void vscode.window.showInformationMessage(
        `Plugin step ${node.step.name} is already ${enabled ? "enabled" : "disabled"}.`,
      );
      return;
    }
  }

  if (options.confirmation) {
    const confirmation = await vscode.window.showWarningMessage(
      `${options.confirmation} plugin step '${node.step.name}' in ${node.env.name}?`,
      { modal: true },
      options.confirmation,
    );
    if (confirmation !== options.confirmation) {
      return;
    }
  }

  const service = await resolveServiceForNode(
    options.placeHolder,
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
    await service.setStepState(node.step.id, enabled);
    explorer.refresh();
    void vscode.window.showInformationMessage(options.successMessage(node.step.name));
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to ${options.action} plugin step ${node.step.name}: ${String(error)}`,
    );
  }
}
