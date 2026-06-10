import { ButtonNode, CustomAction, LocLabel, RibbonScope, RibbonView } from "./models";

export type RibbonPreviewItemKind = "Button" | "Group" | "Tab" | "MenuSection" | "Unknown";

export interface RibbonPreviewItem {
  id: string;
  label: string;
  kind: RibbonPreviewItemKind;
  commandId?: string;
  tooltip?: string;
  imageName?: string;
  sequence?: number;
}

export interface RibbonPreviewHiddenItem {
  id: string;
}

export interface RibbonPreviewLocation {
  location: string;
  label: string;
  items: RibbonPreviewItem[];
  hidden: RibbonPreviewHiddenItem[];
}

export interface RibbonPreviewModel {
  scope: RibbonScope;
  locations: RibbonPreviewLocation[];
  isEmpty: boolean;
}

const DEFAULT_LANGUAGE_CODE = 1033;
const LOCATION_STOP_WORDS = new Set(["Controls", "_children", "Menu", "MenuSection"]);

export function buildRibbonPreview(view: RibbonView): RibbonPreviewModel {
  const locations = new Map<string, RibbonPreviewLocation>();

  const ensureLocation = (location: string): RibbonPreviewLocation => {
    const key = location ?? "";
    let entry = locations.get(key);
    if (!entry) {
      entry = { location: key, label: locationLabel(key), items: [], hidden: [] };
      locations.set(key, entry);
    }
    return entry;
  };

  for (const action of view.customActions) {
    ensureLocation(action.location).items.push(previewItem(action, view.locLabels));
  }

  for (const hide of view.hideActions) {
    ensureLocation(hide.location).hidden.push({ id: hide.hideActionId });
  }

  for (const entry of locations.values()) {
    entry.items = sortBySequence(entry.items);
  }

  const ordered = [...locations.values()];

  return {
    scope: view.scope,
    locations: ordered,
    isEmpty: ordered.every((entry) => entry.items.length === 0 && entry.hidden.length === 0),
  };
}

function previewItem(action: CustomAction, locLabels: LocLabel[]): RibbonPreviewItem {
  const ui = action.commandUI;
  const sequence = action.sequence ?? (ui && "sequence" in ui ? ui.sequence : undefined);

  if (ui?.kind === "Button") {
    return {
      id: ui.id || action.id,
      label: buttonLabel(ui, locLabels) ?? ui.command ?? ui.id ?? action.id,
      kind: "Button",
      commandId: ui.command || undefined,
      tooltip: buttonTooltip(ui, locLabels),
      imageName:
        ui.modernImage?.webResourceUniqueName ??
        ui.image16x16?.webResourceUniqueName ??
        ui.image32x32?.webResourceUniqueName,
      sequence,
    };
  }

  if (ui?.kind === "Group") {
    return {
      id: ui.id || action.id,
      label: ui.title || ui.id || action.id,
      kind: "Group",
      commandId: ui.command || undefined,
      sequence,
    };
  }

  if (ui?.kind === "Tab") {
    return {
      id: ui.id || action.id,
      label: ui.title || ui.id || action.id,
      kind: "Tab",
      commandId: ui.command || undefined,
      sequence,
    };
  }

  if (ui?.kind === "MenuSection") {
    return { id: ui.id || action.id, label: ui.id || action.id, kind: "MenuSection", sequence };
  }

  return { id: action.id, label: action.id || "(custom action)", kind: "Unknown", sequence };
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
