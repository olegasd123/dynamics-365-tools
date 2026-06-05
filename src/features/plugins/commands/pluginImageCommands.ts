import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { PluginImageNode, PluginStepNode } from "../pluginExplorer";
import {
  asTooltipString,
  getDefaultMessagePropertyName,
  pickFilteringAttributes,
  pickImageType,
  resolveServiceForNode,
} from "./pluginRegistrationPrompts";

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

  const type = await pickImageType(node.step);
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

  const type = await pickImageType(node.step, node.image.type);
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

export async function copyImageDescription(node?: PluginImageNode): Promise<void> {
  if (!node) {
    void vscode.window.showInformationMessage(
      "Run this command from a plugin image in the Plugins explorer.",
    );
    return;
  }

  const tooltip = asTooltipString(node.tooltip);
  if (!tooltip) {
    void vscode.window.showInformationMessage("No image info to copy.");
    return;
  }

  await vscode.env.clipboard.writeText(tooltip);
  void vscode.window.showInformationMessage("Image info copied to clipboard.");
}
