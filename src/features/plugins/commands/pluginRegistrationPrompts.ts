import * as vscode from "vscode";
import { pickEnvironmentAndAuth } from "@app/commandUtils";
import { AuthService } from "@features/auth/authService";
import { SecretService } from "@features/auth/secretService";
import { ConfigurationService } from "@features/config/configurationService";
import { Dynamics365Configuration } from "@features/config/domain/models";
import { EnvironmentConnectionService } from "@features/dataverse/environmentConnectionService";
import { SolutionComponentService } from "@features/dataverse/solutionComponentService";
import { LastSelectionService } from "@app/lastSelectionService";
import { SolutionPicker } from "@app/solutionPicker";
import { PluginStep } from "../models";
import { PluginService } from "../pluginService";
import type { NotificationPort } from "@app/ports/notifications";
import {
  asTooltipString,
  buildFilteringAttributePickItems,
  buildMessageNamePickItems,
  buildModePickItems,
  buildPrimaryEntityPickItems,
  buildStagePickItems,
  buildStepDefaultName,
  getDefaultMessagePropertyName,
  getImageTypeOptions,
  normalizeOptionalInput,
  type FilteringAttributePickItem,
  type MessageNamePickItem,
  type PrimaryEntityPickItem,
} from "./pluginRegistrationLogic";

export { asTooltipString, buildStepDefaultName, getDefaultMessagePropertyName };

type PrimaryEntityPick = { value?: string; cancelled: boolean };
type FilteringAttributesPick = { value?: string; cancelled: boolean };

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

  const selection = await vscode.window.showQuickPick(
    buildMessageNamePickItems(messageNames, defaultValue),
    {
      placeHolder: "Select SDK message name",
      matchOnDescription: true,
      ignoreFocusOut: true,
    },
  );

  if (!selection) return undefined;
  if ((selection as MessageNamePickItem).isCustom) {
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

  const selection = await vscode.window.showQuickPick(
    buildPrimaryEntityPickItems(entities, defaultValue),
    {
      placeHolder: "Select primary entity or choose global message",
      matchOnDescription: true,
      ignoreFocusOut: true,
    },
  );

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
  return { value: normalizeOptionalInput(value), cancelled: false };
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

  const selection = await vscode.window.showQuickPick(
    buildFilteringAttributePickItems(attributes, defaultValue),
    {
      placeHolder: "Select filtering attributes",
      matchOnDescription: true,
      canPickMany: true,
      ignoreFocusOut: true,
    },
  );

  if (!selection) return { value: defaultValue, cancelled: true };

  if (selection.some((item) => (item as FilteringAttributePickItem).pickType === "custom")) {
    return promptForFilteringAttributes(defaultValue);
  }

  const chosen = selection
    .filter((item) => (item as FilteringAttributePickItem).pickType === "attribute")
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
  return { value: normalizeOptionalInput(value), cancelled: false };
}

export async function pickStage(defaultStage?: number): Promise<number | undefined> {
  const pick = await vscode.window.showQuickPick(buildStagePickItems(defaultStage), {
    placeHolder: "Select pipeline stage",
  });
  return pick?.value;
}

export async function pickMode(defaultMode?: number): Promise<number | undefined> {
  const pick = await vscode.window.showQuickPick(buildModePickItems(defaultMode), {
    placeHolder: "Select execution mode",
  });
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
