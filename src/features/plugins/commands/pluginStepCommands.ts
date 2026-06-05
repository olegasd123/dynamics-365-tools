import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { ConfigurationService } from "../../config/configurationService";
import { SolutionPicker } from "../../../platform/vscode/ui/solutionPicker";
import { SecretService } from "../../auth/secretService";
import { AuthService } from "../../auth/authService";
import { LastSelectionService } from "../../../platform/vscode/lastSelectionStore";
import { EnvironmentConnectionService } from "../../dataverse/environmentConnectionService";
import { PluginExplorerProvider, PluginStepNode, PluginTypeNode } from "../pluginExplorer";
import {
  asTooltipString,
  buildStepDefaultName,
  pickFilteringAttributes,
  pickMessageName,
  pickMode,
  pickPrimaryEntity,
  pickStage,
  resolveServiceForNode,
} from "./pluginRegistrationPrompts";

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
  if (node.pluginType.isWorkflowActivity) {
    void vscode.window.showInformationMessage("Workflow activities cannot have plugin steps.");
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

export async function copyStepDescription(node?: PluginStepNode): Promise<void> {
  if (!node) {
    void vscode.window.showInformationMessage(
      "Run this command from a plugin step in the Plugins explorer.",
    );
    return;
  }

  const tooltip = asTooltipString(node.tooltip);
  if (!tooltip) {
    void vscode.window.showInformationMessage("No step info to copy.");
    return;
  }

  await vscode.env.clipboard.writeText(tooltip);
  void vscode.window.showInformationMessage("Step info copied to clipboard.");
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

export {
  copyImageDescription,
  createPluginImage,
  deletePluginImage,
  editPluginImage,
} from "./pluginImageCommands";
