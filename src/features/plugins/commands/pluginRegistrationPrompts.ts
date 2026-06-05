import * as vscode from "vscode";
import { pickEnvironmentAndAuth } from "../../../platform/vscode/commandUtils";
import { AuthService } from "../../auth/authService";
import { SecretService } from "../../auth/secretService";
import { ConfigurationService } from "../../config/configurationService";
import { Dynamics365Configuration } from "../../config/domain/models";
import { EnvironmentConnectionService } from "../../dataverse/environmentConnectionService";
import { SolutionComponentService } from "../../dataverse/solutionComponentService";
import { LastSelectionService } from "../../../platform/vscode/lastSelectionStore";
import { SolutionPicker } from "../../../platform/vscode/ui/solutionPicker";
import { PluginStep } from "../models";
import { PluginService } from "../pluginService";
import type { NotificationPort } from "../../../app/ports/notifications";

type MessagePickItem = vscode.QuickPickItem & { isCustom?: boolean };
type PrimaryEntityPick = { value?: string; cancelled: boolean };
type PrimaryEntityPickItem = vscode.QuickPickItem & { type: "entity" | "custom" | "none" };
type FilteringAttributesPick = { value?: string; cancelled: boolean };
type FilteringPickItem = vscode.QuickPickItem & { pickType: "attribute" | "custom" };

export async function resolveServiceForNode(
  placeHolder: string,
  configuration: ConfigurationService,
  ui: SolutionPicker,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  connections: EnvironmentConnectionService,
  preferredEnv: string,
  notifications: NotificationPort,
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
    notifications,
  );
  if (!selection) return undefined;

  const client = await connections.createClient(selection.env, selection.auth);
  if (!client) return undefined;

  const solutionComponents = new SolutionComponentService(client);
  return new PluginService(client, solutionComponents);
}

export function buildStepDefaultName(
  typeName: string,
  message: string,
  entity: string | undefined,
): string {
  const entityLabel = entity || "global";
  return `${typeName}: ${message} of ${entityLabel}`;
}

export async function pickMessageName(
  service: PluginService,
  notifications: NotificationPort,
  defaultValue = "Create",
): Promise<string | undefined> {
  let messageNames: string[] = [];
  try {
    messageNames = await service.listSdkMessageNames();
  } catch (error) {
    await notifications.warning(
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

export async function pickPrimaryEntity(
  service: PluginService,
  notifications: NotificationPort,
  defaultValue?: string,
): Promise<PrimaryEntityPick> {
  let entities: string[] = [];
  try {
    entities = await service.listEntityLogicalNames();
  } catch (error) {
    await notifications.warning(
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

export async function pickFilteringAttributes(
  service: PluginService,
  notifications: NotificationPort,
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
    await notifications.warning(`Unable to load attributes. Enter them manually. ${String(error)}`);
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

export async function pickStage(defaultStage?: number): Promise<number | undefined> {
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

export async function pickMode(defaultMode?: number): Promise<number | undefined> {
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

export async function pickImageType(
  step: PluginStep,
  defaultType?: number,
): Promise<number | undefined> {
  const options = getImageTypeOptions(step);
  const pick = await vscode.window.showQuickPick(
    options.map((o) => ({
      label: o.label,
      description: o.description,
      value: o.value,
      picked: o.value === defaultType,
    })),
    { placeHolder: "Select image type" },
  );
  return pick?.value;
}

export function getDefaultMessagePropertyName(step: PluginStep): string {
  const message = step.messageName?.toLowerCase();
  if (message === "create") {
    return "Id";
  }
  return "Target";
}

function getImageTypeOptions(
  step: PluginStep,
): Array<{ label: string; value: number; description?: string }> {
  const message = step.messageName?.toLowerCase();
  if (message === "create") {
    return [{ label: "Post-image", value: 1, description: "Create supports post-images only" }];
  }
  if (message === "delete") {
    return [{ label: "Pre-image", value: 0, description: "Delete supports pre-images only" }];
  }
  return [
    { label: "Pre-image", value: 0 },
    { label: "Post-image", value: 1 },
    { label: "Both", value: 2 },
  ];
}

export function asTooltipString(
  tooltip: string | vscode.MarkdownString | undefined,
): string | undefined {
  if (!tooltip) return undefined;
  const raw = typeof tooltip === "string" ? tooltip : (tooltip.value ?? "");
  const cleaned = raw.replace(/\*\*/g, "").trim();
  return cleaned || undefined;
}
