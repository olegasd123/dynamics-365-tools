import { CommandContext } from "../../../app/commandContext";
import { ConfigurationService } from "../../config/configurationService";
import { SolutionPicker } from "../../../app/solutionPicker";
import { SecretService } from "../../auth/secretService";
import { AuthService } from "../../auth/authService";
import { LastSelectionService } from "../../../platform/vscode/lastSelectionStore";
import { EnvironmentConnectionService } from "../../dataverse/environmentConnectionService";
import { PluginExplorerProvider, PluginStepNode, PluginTypeNode } from "../pluginExplorer";
import type { NotificationPort } from "../../../app/ports/notifications";
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
  const { configuration, ui, secrets, auth, lastSelection, connections, notifications, input } =
    ctx.core;
  const { explorer } = ctx.plugins;
  const config = await configuration.loadConfiguration();
  if (!node) {
    void notifications.info("Run this command from a plugin type in the Plugins explorer.");
    return;
  }
  if (node.pluginType.isWorkflowActivity) {
    void notifications.info("Workflow activities cannot have plugin steps.");
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
    notifications,
    config,
  );
  if (!service) return;

  const messageName = await pickMessageName(service, notifications);
  if (!messageName) return;

  const primaryEntityPick = await pickPrimaryEntity(service, notifications);
  if (primaryEntityPick.cancelled) return;
  const primaryEntity = primaryEntityPick.value;

  const filteringAttributesPick = await pickFilteringAttributes(
    service,
    notifications,
    primaryEntity ?? undefined,
  );
  if (filteringAttributesPick.cancelled) return;
  const filteringAttributes = filteringAttributesPick.value;

  const stage = await pickStage();
  if (stage === undefined) return;

  const mode = await pickMode();
  if (mode === undefined) return;

  const rankValue = await input.showInputBox({
    prompt: "Execution rank (lower runs first)",
    value: "1",
    validateInput: (val) => (Number.isNaN(Number(val)) ? "Enter a number" : undefined),
    ignoreFocusOut: true,
  });
  if (rankValue === undefined) return;
  const rank = Number(rankValue) || 1;

  const defaultName = buildStepDefaultName(node.pluginType.name, messageName, primaryEntity);
  const name = await input.showInputBox({
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
    void notifications.info(`Plugin step ${name} created.`);
  } catch (error) {
    void notifications.error(`Failed to create plugin step: ${String(error)}`);
  }
}

export async function editPluginStep(ctx: CommandContext, node?: PluginStepNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, notifications, input } =
    ctx.core;
  const { explorer } = ctx.plugins;
  if (!node) {
    void notifications.info("Run this command from a plugin step in the Plugins explorer.");
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
    notifications,
  );
  if (!service) return;

  const messageName = await pickMessageName(
    service,
    notifications,
    node.step.messageName ?? "Create",
  );
  if (!messageName) return;

  const primaryEntityPick = await pickPrimaryEntity(
    service,
    notifications,
    node.step.primaryEntity,
  );
  if (primaryEntityPick.cancelled) return;
  const primaryEntity = primaryEntityPick.value;

  const filteringAttributesPick = await pickFilteringAttributes(
    service,
    notifications,
    primaryEntity ?? undefined,
    node.step.filteringAttributes ?? "",
  );
  if (filteringAttributesPick.cancelled) return;
  const filteringAttributes = filteringAttributesPick.value;

  const stage = await pickStage(node.step.stage);
  if (stage === undefined) return;

  const mode = await pickMode(node.step.mode);
  if (mode === undefined) return;

  const rankValue = await input.showInputBox({
    prompt: "Execution rank (lower runs first)",
    value: String(node.step.rank ?? 1),
    validateInput: (val) => (Number.isNaN(Number(val)) ? "Enter a number" : undefined),
    ignoreFocusOut: true,
  });
  if (rankValue === undefined) return;
  const rank = Number(rankValue) || 1;

  const name = await input.showInputBox({
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
    void notifications.info(`Plugin step ${name} updated.`);
  } catch (error) {
    void notifications.error(`Failed to update plugin step: ${String(error)}`);
  }
}

export async function enablePluginStep(ctx: CommandContext, node?: PluginStepNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections } = ctx.core;
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
    ctx.plugins.explorer,
    node,
    true,
    ctx.core.notifications,
  );
}

export async function disablePluginStep(ctx: CommandContext, node?: PluginStepNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections } = ctx.core;
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
    ctx.plugins.explorer,
    node,
    false,
    ctx.core.notifications,
  );
}

export async function deletePluginStep(ctx: CommandContext, node?: PluginStepNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, notifications } = ctx.core;
  const { explorer } = ctx.plugins;
  if (!node) {
    void notifications.info("Run this command from a plugin step in the Plugins explorer.");
    return;
  }

  const confirmed = await notifications.askWarning(
    `Delete plugin '${node.step.name}' step from ${node.env.name}?`,
    ["Delete"],
    { modal: true },
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
    notifications,
  );
  if (!service) return;

  try {
    await service.deleteStep(node.step.id);
    explorer.refresh();
    void notifications.info(`Plugin ${node.step.name} step deleted.`);
  } catch (error) {
    void notifications.error(`Failed to delete plugin step: ${String(error)}`);
  }
}

export async function copyStepDescription(
  ctx: CommandContext,
  node?: PluginStepNode,
): Promise<void> {
  if (!node) {
    void ctx.core.notifications.info(
      "Run this command from a plugin step in the Plugins explorer.",
    );
    return;
  }

  const tooltip = asTooltipString(node.tooltip);
  if (!tooltip) {
    void ctx.core.notifications.info("No step info to copy.");
    return;
  }

  await ctx.core.clipboard.writeText(tooltip);
  void ctx.core.notifications.info("Step info copied to clipboard.");
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
  notifications: NotificationPort,
): Promise<void> {
  if (!node) {
    void notifications.info(
      `Run this command from a plugin step in the Plugins explorer to ${options.action} it.`,
    );
    return;
  }

  if (node.step.status !== undefined) {
    const isEnabled = node.step.status === 0;
    if (isEnabled === enabled) {
      void notifications.info(
        `Plugin step ${node.step.name} is already ${enabled ? "enabled" : "disabled"}.`,
      );
      return;
    }
  }

  if (options.confirmation) {
    const confirmation = await notifications.askWarning(
      `${options.confirmation} plugin step '${node.step.name}' in ${node.env.name}?`,
      [options.confirmation],
      { modal: true },
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
    notifications,
  );
  if (!service) return;

  try {
    await service.setStepState(node.step.id, enabled);
    explorer.refresh();
    void notifications.info(options.successMessage(node.step.name));
  } catch (error) {
    void notifications.error(
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
