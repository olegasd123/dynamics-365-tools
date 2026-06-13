import { ButtonNode, CustomAction, HideAction, LocLabel, RibbonScope, RibbonView } from "./models";
import { listOobRibbonCommands, listOobRibbonLocations } from "./oobCatalog";

export type RibbonPreviewItemKind = "Button" | "Group" | "Tab" | "MenuSection" | "Unknown";
export type RibbonPreviewItemSource = "oob" | "custom";

export interface RibbonPreviewItem {
  id: string;
  label: string;
  kind: RibbonPreviewItemKind;
  source: RibbonPreviewItemSource;
  hidden: boolean;
  commandId?: string;
  controlId?: string;
  tooltip?: string;
  imageName?: string;
  sequence?: number;
}

export interface RibbonPreviewGroup {
  id: string;
  label: string;
  location: string;
  sequence: number;
  items: RibbonPreviewItem[];
}

export interface RibbonPreviewModel {
  scope: RibbonScope;
  tabLabel: string;
  groups: RibbonPreviewGroup[];
  hasCustomizations: boolean;
  isEmpty: boolean;
}

const DEFAULT_LANGUAGE_CODE = 1033;
const DEFAULT_ENTITY_TOKEN = "{entity}";
const HIDDEN_GROUP_KEY = "__hidden__";
const CUSTOM_GROUP_SEQUENCE_BASE = 100000;
const HIDDEN_GROUP_SEQUENCE = Number.MAX_SAFE_INTEGER;
const LOCATION_STOP_WORDS = new Set(["Controls", "_children", "Menu", "MenuSection"]);

export function buildRibbonPreview(
  view: RibbonView,
  entityLogicalName?: string,
): RibbonPreviewModel {
  const entity = entityLogicalName || DEFAULT_ENTITY_TOKEN;
  const groups = new Map<string, RibbonPreviewGroup>();
  let customGroupCount = 0;

  const ensureGroup = (
    location: string,
    id: string,
    label: string,
    sequence: number,
  ): RibbonPreviewGroup => {
    let group = groups.get(location);
    if (!group) {
      group = { id, label, location, sequence, items: [] };
      groups.set(location, group);
    }
    return group;
  };

  const oobLocations = listOobRibbonLocations(view.scope, entity);
  const oobByLocationId = new Map(oobLocations.map((location) => [location.id, location]));
  for (const location of oobLocations) {
    ensureGroup(location.location, location.id, location.group, groupSequence(location.sequence));
  }
  for (const command of listOobRibbonCommands(view.scope, entity)) {
    for (const locationId of command.locationIds) {
      const location = oobByLocationId.get(locationId);
      if (!location) {
        continue;
      }
      ensureGroup(
        location.location,
        location.id,
        location.group,
        groupSequence(location.sequence),
      ).items.push({
        id: command.id,
        label: command.label,
        kind: "Button",
        source: "oob",
        hidden: false,
        commandId: command.commandId,
        controlId: command.controlId,
        imageName: command.image16x16,
        sequence: command.sequence,
      });
    }
  }

  for (const action of view.customActions) {
    const matched = oobLocations.find((location) => location.location === action.location);
    const existed = groups.has(action.location);
    const group = ensureGroup(
      action.location,
      action.location,
      matched?.group ?? locationLabel(action.location),
      matched ? groupSequence(matched.sequence) : CUSTOM_GROUP_SEQUENCE_BASE + customGroupCount,
    );
    if (!existed && !matched) {
      customGroupCount += 1;
    }
    group.items.push(customItem(action, view.locLabels));
  }

  for (const hide of view.hideActions) {
    applyHide(groups, hide);
  }

  for (const group of groups.values()) {
    group.items = sortBySequence(group.items);
  }

  const ordered = [...groups.values()]
    .filter((group) => group.items.length > 0)
    .sort((left, right) => left.sequence - right.sequence);

  return {
    scope: view.scope,
    tabLabel: tabLabel(view.scope, entity),
    groups: ordered,
    hasCustomizations: view.customActions.length > 0 || view.hideActions.length > 0,
    isEmpty: ordered.length === 0,
  };
}

function groupSequence(sequence: number | undefined): number {
  return sequence ?? CUSTOM_GROUP_SEQUENCE_BASE;
}

function customItem(action: CustomAction, locLabels: LocLabel[]): RibbonPreviewItem {
  const ui = action.commandUI;
  const sequence = action.sequence ?? (ui && "sequence" in ui ? ui.sequence : undefined);
  const base = { source: "custom" as const, hidden: false, sequence };

  if (ui?.kind === "Button") {
    return {
      ...base,
      id: ui.id || action.id,
      label: cleanLabel(buttonLabel(ui, locLabels) ?? ui.command ?? ui.id ?? action.id),
      kind: "Button",
      commandId: ui.command || undefined,
      tooltip: buttonTooltip(ui, locLabels),
      imageName:
        ui.modernImage?.webResourceUniqueName ??
        ui.image16x16?.webResourceUniqueName ??
        ui.image32x32?.webResourceUniqueName,
    };
  }

  if (ui?.kind === "Group") {
    return {
      ...base,
      id: ui.id || action.id,
      label: cleanLabel(ui.title || ui.id || action.id),
      kind: "Group",
      commandId: ui.command || undefined,
    };
  }

  if (ui?.kind === "Tab") {
    return {
      ...base,
      id: ui.id || action.id,
      label: cleanLabel(ui.title || ui.id || action.id),
      kind: "Tab",
      commandId: ui.command || undefined,
    };
  }

  if (ui?.kind === "MenuSection") {
    return {
      ...base,
      id: ui.id || action.id,
      label: cleanLabel(ui.id || action.id),
      kind: "MenuSection",
    };
  }

  return {
    ...base,
    id: action.id,
    label: cleanLabel(action.id || "(custom action)"),
    kind: "Unknown",
  };
}

function applyHide(groups: Map<string, RibbonPreviewGroup>, hide: HideAction): void {
  const targets = [hide.hideActionId, hide.location].filter(Boolean);
  let matched = false;
  for (const group of groups.values()) {
    for (const item of group.items) {
      if (targets.includes(item.id) || (item.controlId && targets.includes(item.controlId))) {
        item.hidden = true;
        matched = true;
      }
    }
  }

  if (matched) {
    return;
  }

  let hiddenGroup = groups.get(HIDDEN_GROUP_KEY);
  if (!hiddenGroup) {
    hiddenGroup = {
      id: HIDDEN_GROUP_KEY,
      label: "Hidden",
      location: "",
      sequence: HIDDEN_GROUP_SEQUENCE,
      items: [],
    };
    groups.set(HIDDEN_GROUP_KEY, hiddenGroup);
  }
  hiddenGroup.items.push({
    id: hide.hideActionId,
    label: lastSegment(hide.location || hide.hideActionId.replace(/\.Hide$/, "")),
    kind: "Button",
    source: "oob",
    hidden: true,
    controlId: hide.location || hide.hideActionId,
  });
}

function buttonLabel(button: ButtonNode, locLabels: LocLabel[]): string | undefined {
  if (button.labelText) {
    return button.labelText;
  }
  return button.labelLocId ? resolveLocLabel(button.labelLocId, locLabels) : undefined;
}

function buttonTooltip(button: ButtonNode, locLabels: LocLabel[]): string | undefined {
  if (button.toolTipTitle) {
    return button.toolTipTitle;
  }
  return button.toolTipTitleLocId
    ? resolveLocLabel(button.toolTipTitleLocId, locLabels)
    : undefined;
}

function resolveLocLabel(locId: string, locLabels: LocLabel[]): string | undefined {
  const label = locLabels.find((item) => item.id === locId);
  if (!label || label.titles.length === 0) {
    return undefined;
  }
  const preferred = label.titles.find((title) => title.languageCode === DEFAULT_LANGUAGE_CODE);
  return (preferred ?? label.titles[0]).description;
}

function sortBySequence(items: RibbonPreviewItem[]): RibbonPreviewItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftSequence = left.item.sequence ?? Number.POSITIVE_INFINITY;
      const rightSequence = right.item.sequence ?? Number.POSITIVE_INFINITY;
      if (leftSequence !== rightSequence) {
        return leftSequence - rightSequence;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

function tabLabel(scope: RibbonScope, entity: string): string {
  if (scope === "Application") {
    return "Mscrm.GlobalTab";
  }
  return `Mscrm.${scope}.${entity}.MainTab`;
}

function locationLabel(location: string): string {
  if (!location) {
    return "(no location)";
  }

  const parts = location.split(".").filter(Boolean);
  const meaningful: string[] = [];
  for (const part of parts) {
    if (LOCATION_STOP_WORDS.has(part)) {
      break;
    }
    meaningful.push(part);
  }

  const tail = (meaningful.length ? meaningful : parts).slice(-2);
  return tail.join(" › ") || location;
}

function lastSegment(id: string): string {
  const parts = id.split(".").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : id;
}

function cleanLabel(value: string): string {
  if (value.startsWith("$Resources:") || value.startsWith("$LocLabels:")) {
    const token = value.slice(value.indexOf(":") + 1).replace(/\.(LabelText|Title|Text)$/i, "");
    return lastSegment(token);
  }
  if (value.startsWith("mso.") || /\.CustomAction$/i.test(value)) {
    return lastSegment(value.replace(/\.CustomAction$/i, ""));
  }
  return value;
}
