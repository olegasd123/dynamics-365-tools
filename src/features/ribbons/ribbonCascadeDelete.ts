import {
  CommandDefinition,
  CustomAction,
  DisplayRule,
  EnableRule,
  LocLabel,
  RibbonDocument,
  RibbonPatch,
  TextRange,
  XmlElementRange,
} from "./models";
import { createDeleteNodePatch } from "./ribbonEditPatches";
import { scanXmlElements } from "./ribbonXmlReader";

export type RibbonCascadeDeleteKind =
  | "CustomAction"
  | "CommandDefinition"
  | "EnableRule"
  | "DisplayRule"
  | "LocLabel";

export interface RibbonCascadeDeleteItem {
  kind: RibbonCascadeDeleteKind;
  id: string;
  range: TextRange;
  reason?: string;
}

export interface RibbonCascadeDeletePlan {
  primary: RibbonCascadeDeleteItem;
  related: RibbonCascadeDeleteItem[];
  patches: RibbonPatch[];
}

interface RibbonDeleteInventory {
  customActions: CustomAction[];
  commandDefinitions: CommandDefinition[];
  enableRules: EnableRule[];
  displayRules: DisplayRule[];
  locLabels: LocLabel[];
}

export function createRibbonCascadeDeletePlan(
  document: RibbonDocument,
  contextValue: string,
  range: TextRange,
): RibbonCascadeDeletePlan | undefined {
  const inventory = collectInventory(document);
  const primary = findPrimaryDeleteItem(inventory, contextValue, range);
  if (!primary) {
    return undefined;
  }

  const related = findRelatedDeleteItems(document, inventory, primary);
  const deleteItems = [primary, ...related];
  const patches = [
    ...deleteItems.map((item) => createDeleteNodePatch(document.sourceText, item.range)),
    ...createDeletedRuleReferencePatches(document, inventory.commandDefinitions, deleteItems),
  ].sort((left, right) => patchStart(right) - patchStart(left));

  return { primary, related, patches };
}

export function formatRibbonCascadeDeleteItem(item: RibbonCascadeDeleteItem): string {
  switch (item.kind) {
    case "CustomAction":
      return `Custom action: ${item.id}`;
    case "CommandDefinition":
      return `Command definition: ${item.id}`;
    case "EnableRule":
      return `Enable rule: ${item.id}`;
    case "DisplayRule":
      return `Display rule: ${item.id}`;
    case "LocLabel":
      return `Loc label: ${item.id}`;
  }
}

function collectInventory(document: RibbonDocument): RibbonDeleteInventory {
  return {
    customActions: uniqueByRange(document.views.flatMap((view) => view.customActions)),
    commandDefinitions: uniqueByRange(document.views.flatMap((view) => view.commandDefinitions)),
    enableRules: uniqueByRange(document.views.flatMap((view) => view.enableRules)),
    displayRules: uniqueByRange(document.views.flatMap((view) => view.displayRules)),
    locLabels: uniqueByRange(document.views.flatMap((view) => view.locLabels)),
  };
}

function findPrimaryDeleteItem(
  inventory: RibbonDeleteInventory,
  contextValue: string,
  range: TextRange,
): RibbonCascadeDeleteItem | undefined {
  if (contextValue === "d365RibbonCustomAction") {
    const action = inventory.customActions.find((item) => sameRange(item.range, range));
    return action && { kind: "CustomAction", id: action.id, range: action.range };
  }

  if (contextValue === "d365RibbonCommandDefinition") {
    const command = inventory.commandDefinitions.find((item) => sameRange(item.range, range));
    return command && { kind: "CommandDefinition", id: command.id, range: command.range };
  }

  if (contextValue === "d365RibbonEnableRule") {
    const rule = inventory.enableRules.find((item) => sameRange(item.range, range));
    return rule && { kind: "EnableRule", id: rule.id, range: rule.range };
  }

  if (contextValue === "d365RibbonDisplayRule") {
    const rule = inventory.displayRules.find((item) => sameRange(item.range, range));
    return rule && { kind: "DisplayRule", id: rule.id, range: rule.range };
  }

  if (contextValue === "d365RibbonLocLabel") {
    const label = inventory.locLabels.find((item) => sameRange(item.range, range));
    return label && { kind: "LocLabel", id: label.id, range: label.range };
  }

  return undefined;
}

function findRelatedDeleteItems(
  document: RibbonDocument,
  inventory: RibbonDeleteInventory,
  primary: RibbonCascadeDeleteItem,
): RibbonCascadeDeleteItem[] {
  const selected = new Map<string, RibbonCascadeDeleteItem>([[itemKey(primary), primary]]);
  const related: RibbonCascadeDeleteItem[] = [];
  const commandReferences = countCommandReferences(inventory.customActions);
  const enableRuleReferences = countRuleReferences(inventory.commandDefinitions, "enable");
  const displayRuleReferences = countRuleReferences(inventory.commandDefinitions, "display");
  const locLabelReferences = countLocLabelReferences(document);

  let changed = true;
  while (changed) {
    changed = false;

    const selectedCommandIds = idsForKind(selected, "CommandDefinition");
    const selectedCustomActions = inventory.customActions.filter((action) =>
      selected.has(itemKey({ kind: "CustomAction", id: action.id, range: action.range })),
    );
    const selectedCustomActionCommandIds = new Set(
      selectedCustomActions.map(commandIdFromCustomAction).filter(isDefined),
    );
    const selectedLocLabelIds = idsForKind(selected, "LocLabel");

    for (const action of inventory.customActions) {
      const commandId = commandIdFromCustomAction(action);
      if (
        !commandId ||
        !selectedCommandIds.has(commandId) ||
        (commandReferences.get(commandId) ?? 0) !== 1
      ) {
        continue;
      }

      changed = addRelated(selected, related, {
        kind: "CustomAction",
        id: action.id,
        range: action.range,
        reason: `It uses only ${commandId}.`,
      });
    }

    for (const action of inventory.customActions) {
      const actionLabelIds = locLabelIdsFromCustomAction(action);
      if (
        !actionLabelIds.some((id) => selectedLocLabelIds.has(id)) ||
        actionLabelIds.some((id) => (locLabelReferences.get(id) ?? 0) !== 1)
      ) {
        continue;
      }

      changed = addRelated(selected, related, {
        kind: "CustomAction",
        id: action.id,
        range: action.range,
        reason: "Only this custom action uses the deleted loc label.",
      });
    }

    for (const command of inventory.commandDefinitions) {
      if (
        !selectedCustomActionCommandIds.has(command.id) ||
        (commandReferences.get(command.id) ?? 0) !== 1
      ) {
        continue;
      }

      changed = addRelated(selected, related, {
        kind: "CommandDefinition",
        id: command.id,
        range: command.range,
        reason: "Only the deleted custom action uses it.",
      });
    }

    const selectedCommands = inventory.commandDefinitions.filter((command) =>
      selected.has(itemKey({ kind: "CommandDefinition", id: command.id, range: command.range })),
    );
    const selectedEnableRuleIds = new Set(
      selectedCommands.flatMap((command) => command.enableRuleRefs),
    );
    const selectedDisplayRuleIds = new Set(
      selectedCommands.flatMap((command) => command.displayRuleRefs),
    );

    for (const rule of inventory.enableRules) {
      if (!selectedEnableRuleIds.has(rule.id) || (enableRuleReferences.get(rule.id) ?? 0) !== 1) {
        continue;
      }

      changed = addRelated(selected, related, {
        kind: "EnableRule",
        id: rule.id,
        range: rule.range,
        reason: "Only the deleted command uses it.",
      });
    }

    for (const rule of inventory.displayRules) {
      if (!selectedDisplayRuleIds.has(rule.id) || (displayRuleReferences.get(rule.id) ?? 0) !== 1) {
        continue;
      }

      changed = addRelated(selected, related, {
        kind: "DisplayRule",
        id: rule.id,
        range: rule.range,
        reason: "Only the deleted command uses it.",
      });
    }

    const selectedCustomActionLocLabelIds = new Set(
      selectedCustomActions.flatMap(locLabelIdsFromCustomAction),
    );
    for (const label of inventory.locLabels) {
      if (
        !selectedCustomActionLocLabelIds.has(label.id) ||
        (locLabelReferences.get(label.id) ?? 0) !== 1
      ) {
        continue;
      }

      changed = addRelated(selected, related, {
        kind: "LocLabel",
        id: label.id,
        range: label.range,
        reason: "Only the deleted custom action uses it.",
      });
    }
  }

  return related;
}

function addRelated(
  selected: Map<string, RibbonCascadeDeleteItem>,
  related: RibbonCascadeDeleteItem[],
  item: RibbonCascadeDeleteItem,
): boolean {
  const key = itemKey(item);
  if (selected.has(key)) {
    return false;
  }

  selected.set(key, item);
  related.push(item);
  return true;
}

function countCommandReferences(customActions: CustomAction[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const action of customActions) {
    const commandId = commandIdFromCustomAction(action);
    if (commandId) {
      increment(counts, commandId);
    }
  }
  return counts;
}

function createDeletedRuleReferencePatches(
  document: RibbonDocument,
  commands: CommandDefinition[],
  deleteItems: RibbonCascadeDeleteItem[],
): RibbonPatch[] {
  const deletedCommandRanges = new Set(
    deleteItems
      .filter((item) => item.kind === "CommandDefinition")
      .map((item) => rangeKey(item.range)),
  );
  const deletedEnableRuleIds = idsForKindFromItems(deleteItems, "EnableRule");
  const deletedDisplayRuleIds = idsForKindFromItems(deleteItems, "DisplayRule");

  if (!deletedEnableRuleIds.size && !deletedDisplayRuleIds.size) {
    return [];
  }

  return commands
    .filter((command) => !deletedCommandRanges.has(rangeKey(command.range)))
    .flatMap((command) => [
      ...findCommandRuleRefRanges(document, command, "EnableRules", "EnableRule").filter((ref) =>
        deletedEnableRuleIds.has(ref.id),
      ),
      ...findCommandRuleRefRanges(document, command, "DisplayRules", "DisplayRule").filter((ref) =>
        deletedDisplayRuleIds.has(ref.id),
      ),
    ])
    .map((ref) => createDeleteNodePatch(document.sourceText, ref.range));
}

function findCommandRuleRefRanges(
  document: RibbonDocument,
  command: CommandDefinition,
  containerName: "EnableRules" | "DisplayRules",
  refName: "EnableRule" | "DisplayRule",
): Array<{ id: string; range: TextRange }> {
  const commandElement = collectElements(scanXmlElements(document.sourceText)).find(
    (node) => node.name === "CommandDefinition" && sameRange(node.range, command.range),
  );
  const container = commandElement?.children.find((child) => child.name === containerName);

  return (
    container?.children
      .filter((child) => child.name === refName)
      .map((child) => ({ id: attr(child, "Id"), range: child.range })) ?? []
  );
}

function countRuleReferences(
  commands: CommandDefinition[],
  kind: "enable" | "display",
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const command of commands) {
    const refs = kind === "enable" ? command.enableRuleRefs : command.displayRuleRefs;
    for (const ref of refs) {
      increment(counts, ref);
    }
  }
  return counts;
}

function countLocLabelReferences(document: RibbonDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of collectElements(scanXmlElements(document.sourceText))) {
    if (!rangeContains(document.ribbonRange, node.range)) {
      continue;
    }

    for (const attribute of node.attributes) {
      const locLabelId = locLabelIdFromAttribute(attribute.name, attribute.value);
      if (locLabelId) {
        increment(counts, locLabelId);
      }
    }
  }
  return counts;
}

function locLabelIdFromAttribute(name: string, value: string): string | undefined {
  if (value.toLowerCase().startsWith("$loclabels:")) {
    return value.slice("$LocLabels:".length);
  }

  if (name === "LabelLocId" || name === "ToolTipTitleLocId" || name === "ToolTipDescriptionLocId") {
    return value || undefined;
  }

  return undefined;
}

function commandIdFromCustomAction(action: CustomAction): string | undefined {
  const commandUI = action.commandUI;
  if (!commandUI || commandUI.kind === "MenuSection" || commandUI.kind === "Unknown") {
    return undefined;
  }

  return commandUI.command;
}

function locLabelIdsFromCustomAction(action: CustomAction): string[] {
  if (action.commandUI?.kind !== "Button") {
    return [];
  }

  return [
    action.commandUI.labelLocId,
    action.commandUI.altLocId,
    action.commandUI.toolTipTitleLocId,
    action.commandUI.toolTipDescriptionLocId,
  ].filter(isDefined);
}

function idsForKind(
  selected: Map<string, RibbonCascadeDeleteItem>,
  kind: RibbonCascadeDeleteKind,
): Set<string> {
  return new Set(
    [...selected.values()].filter((item) => item.kind === kind).map((item) => item.id),
  );
}

function idsForKindFromItems(
  items: RibbonCascadeDeleteItem[],
  kind: RibbonCascadeDeleteKind,
): Set<string> {
  return new Set(items.filter((item) => item.kind === kind).map((item) => item.id));
}

function itemKey(item: RibbonCascadeDeleteItem): string {
  return `${item.kind}:${item.range.start}:${item.range.end}`;
}

function rangeKey(range: TextRange): string {
  return `${range.start}:${range.end}`;
}

function attr(node: XmlElementRange, name: string): string {
  return node.attributes.find((attribute) => attribute.name === name)?.value ?? "";
}

function patchStart(patch: RibbonPatch): number {
  return patch.kind === "insert" ? patch.offset : patch.range.start;
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function uniqueByRange<T extends { range: TextRange }>(items: T[]): T[] {
  const seen = new Set<string>();
  const uniqueItems: T[] = [];
  for (const item of items) {
    const key = `${item.range.start}:${item.range.end}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueItems.push(item);
  }
  return uniqueItems;
}

function collectElements(nodes: XmlElementRange[]): XmlElementRange[] {
  return nodes.flatMap((node) => [node, ...collectElements(node.children)]);
}

function rangeContains(parent: TextRange, child: TextRange): boolean {
  return child.start >= parent.start && child.end <= parent.end;
}

function sameRange(left: TextRange, right: TextRange): boolean {
  return left.start === right.start && left.end === right.end;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
