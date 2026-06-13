import type { PluginStep } from "../models";

export interface MessageNamePickItem {
  label: string;
  description?: string;
  picked?: boolean;
  isCustom?: boolean;
}

export interface PrimaryEntityPickItem {
  label: string;
  description?: string;
  picked?: boolean;
  type: "entity" | "custom" | "none";
}

export interface FilteringAttributePickItem {
  label: string;
  description?: string;
  picked?: boolean;
  pickType: "attribute" | "custom";
}

export interface NumericPickItem {
  label: string;
  description?: string;
  value: number;
  picked?: boolean;
}

export function buildStepDefaultName(
  typeName: string,
  message: string,
  entity: string | undefined,
): string {
  const entityLabel = entity || "global";
  return `${typeName}: ${message} of ${entityLabel}`;
}

export function buildMessageNamePickItems(
  messageNames: string[],
  defaultValue?: string,
): MessageNamePickItem[] {
  const deduped = Array.from(new Set(messageNames));
  const items: MessageNamePickItem[] = deduped.map((name) => ({
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
  return withCurrentItemFirst(items);
}

export function buildPrimaryEntityPickItems(
  entities: string[],
  defaultValue?: string,
): PrimaryEntityPickItem[] {
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
  return withCurrentItemFirst(items);
}

export function normalizeOptionalInput(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parseFilteringAttributes(value?: string): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

export function buildFilteringAttributePickItems(
  attributes: string[],
  defaultValue?: string,
): FilteringAttributePickItem[] {
  const defaults = parseFilteringAttributes(defaultValue);
  const sortedAttributes = attributes
    .filter(Boolean)
    .filter((attr, index, list) => list.indexOf(attr) === index)
    .sort((a, b) => a.localeCompare(b))
    .map((attr) => ({
      label: attr,
      pickType: "attribute" as const,
      picked: defaults.has(attr),
    }));
  const currentItems = sortedAttributes
    .filter((item) => item.picked)
    .map((item) => ({
      ...item,
      description: "Current value",
    }));
  const knownAttributes = new Set(sortedAttributes.map((item) => item.label));
  const missingCurrentItems = [...defaults]
    .filter((attr) => !knownAttributes.has(attr))
    .map((attr) => ({
      label: attr,
      description: "Current value",
      pickType: "attribute" as const,
      picked: true,
    }));
  const otherItems = sortedAttributes.filter((item) => !item.picked);

  const currentItemsWithMissing: FilteringAttributePickItem[] = [
    ...missingCurrentItems,
    ...currentItems,
  ];
  const customItem: FilteringAttributePickItem = {
    label: "Enter custom list...",
    description: "Type attributes manually",
    pickType: "custom",
  };
  return currentItemsWithMissing.length
    ? [...currentItemsWithMissing, customItem, ...otherItems]
    : [customItem, ...otherItems];
}

export const PLUGIN_STAGE_OPTIONS: ReadonlyArray<Omit<NumericPickItem, "picked">> = [
  { label: "Pre-validation", description: "Before pipeline", value: 10 },
  { label: "Pre-operation", description: "Before core operation", value: 20 },
  { label: "Post-operation", description: "After core operation", value: 40 },
];

export const PLUGIN_MODE_OPTIONS: ReadonlyArray<Omit<NumericPickItem, "picked">> = [
  { label: "Synchronous", description: "Runs in pipeline", value: 0 },
  { label: "Asynchronous", description: "Background", value: 1 },
];

export function buildStagePickItems(defaultStage?: number): NumericPickItem[] {
  return withCurrentItemFirst(
    PLUGIN_STAGE_OPTIONS.map((option) => ({
      ...option,
      picked: option.value === defaultStage,
    })),
  );
}

export function buildModePickItems(defaultMode?: number): NumericPickItem[] {
  return withCurrentItemFirst(
    PLUGIN_MODE_OPTIONS.map((option) => ({
      ...option,
      picked: option.value === defaultMode,
    })),
  );
}

export function getImageTypeOptions(step: PluginStep): NumericPickItem[] {
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

export function getDefaultMessagePropertyName(step: PluginStep): string {
  const message = step.messageName?.toLowerCase();
  if (message === "create") {
    return "Id";
  }
  return "Target";
}

export function markCurrentPickItems<T extends { description?: string; picked?: boolean }>(
  items: T[],
): T[] {
  return withCurrentItemFirst(items);
}

export function asTooltipString(
  tooltip: string | { value?: string } | undefined,
): string | undefined {
  if (!tooltip) return undefined;
  const raw = typeof tooltip === "string" ? tooltip : (tooltip.value ?? "");
  const cleaned = raw.replace(/\*\*/g, "").trim();
  return cleaned || undefined;
}

function withCurrentItemFirst<T extends { description?: string; picked?: boolean }>(
  items: T[],
): T[] {
  const currentIndex = items.findIndex((item) => item.picked);
  if (currentIndex < 0) {
    return items;
  }

  const current = {
    ...items[currentIndex],
    description: formatCurrentDescription(items[currentIndex].description),
  };
  return [current, ...items.slice(0, currentIndex), ...items.slice(currentIndex + 1)];
}

function formatCurrentDescription(description?: string): string {
  if (description?.startsWith("Current value")) {
    return description;
  }
  return description ? `Current value - ${description}` : "Current value";
}
