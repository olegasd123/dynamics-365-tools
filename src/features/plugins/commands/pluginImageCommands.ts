import { CommandContext } from "@app/commandContext";
import { PluginImageNode, PluginStepNode } from "../pluginExplorer";
import {
  asTooltipString,
  getDefaultMessagePropertyName,
  pickFilteringAttributes,
  pickImageType,
  resolveServiceForNode,
} from "./pluginRegistrationPrompts";

export async function createPluginImage(ctx: CommandContext, node?: PluginStepNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, notifications, input } =
    ctx.core;
  const { explorer } = ctx.plugins;
  if (!node) {
    void notifications.info("Run this command from a plugin step in the Plugins explorer.");
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
    notifications,
  );
  if (!service) return;

  const type = await pickImageType(node.step);
  if (type === undefined) return;

  const entityAlias = await input.showInputBox({
    prompt: "Image entity alias",
    value: type === 0 ? "PreImage" : type === 1 ? "PostImage" : "Image",
    ignoreFocusOut: true,
  });
  if (!entityAlias) return;

  const messagePropertyName = await input.showInputBox({
    prompt: "Message property name",
    value: getDefaultMessagePropertyName(node.step),
    ignoreFocusOut: true,
  });
  if (!messagePropertyName) return;

  const attributesPick = await pickFilteringAttributes(
    service,
    notifications,
    node.step.primaryEntity ?? undefined,
  );
  if (attributesPick.cancelled) return;
  const attributes = attributesPick.value;

  const name = await input.showInputBox({
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
    void notifications.info(`Plugin image ${name} created.`);
  } catch (error) {
    void notifications.error(`Failed to create plugin image: ${String(error)}`);
  }
}

export async function editPluginImage(ctx: CommandContext, node?: PluginImageNode): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, notifications, input } =
    ctx.core;
  const { explorer } = ctx.plugins;
  if (!node) {
    void notifications.info("Run this command from a plugin image in the Plugins explorer.");
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
    notifications,
  );
  if (!service) return;

  const type = await pickImageType(node.step, node.image.type);
  if (type === undefined) return;

  const entityAlias = await input.showInputBox({
    prompt: "Image entity alias",
    value: node.image.entityAlias ?? "Image",
    ignoreFocusOut: true,
  });
  if (!entityAlias) return;

  const messagePropertyName = await input.showInputBox({
    prompt: "Message property name",
    value: node.image.messagePropertyName ?? getDefaultMessagePropertyName(node.step),
    ignoreFocusOut: true,
  });
  if (!messagePropertyName) return;

  const attributesPick = await pickFilteringAttributes(
    service,
    notifications,
    node.step.primaryEntity ?? undefined,
    node.image.attributes ?? "",
  );
  if (attributesPick.cancelled) return;
  const attributes = attributesPick.value;

  const name = await input.showInputBox({
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
    void notifications.info(`Plugin image ${name} updated.`);
  } catch (error) {
    void notifications.error(`Failed to update plugin image: ${String(error)}`);
  }
}

export async function deletePluginImage(
  ctx: CommandContext,
  node?: PluginImageNode,
): Promise<void> {
  const { configuration, ui, secrets, auth, lastSelection, connections, notifications } = ctx.core;
  const { explorer } = ctx.plugins;
  if (!node) {
    void notifications.info("Run this command from a plugin image in the Plugins explorer.");
    return;
  }

  const confirmed = await notifications.askWarning(
    `Delete plugin '${node.image.name}' image from ${node.env.name}?`,
    ["Delete"],
    { modal: true },
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
    notifications,
  );
  if (!service) return;

  try {
    await service.deleteImage(node.image.id);
    explorer.refresh();
    void notifications.info(`Plugin ${node.image.name} image deleted.`);
  } catch (error) {
    void notifications.error(`Failed to delete plugin image: ${String(error)}`);
  }
}

export async function copyImageDescription(
  ctx: CommandContext,
  node?: PluginImageNode,
): Promise<void> {
  if (!node) {
    void ctx.core.notifications.info(
      "Run this command from a plugin image in the Plugins explorer.",
    );
    return;
  }

  const tooltip = asTooltipString(node.tooltip);
  if (!tooltip) {
    void ctx.core.notifications.info("No image info to copy.");
    return;
  }

  await ctx.core.clipboard.writeText(tooltip);
  void ctx.core.notifications.info("Image info copied to clipboard.");
}
