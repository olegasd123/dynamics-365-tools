export interface BuiltInEnableRule {
  id: string;
  description: string;
}

export const BUILT_IN_ENABLE_RULES: BuiltInEnableRule[] = [
  {
    id: "Mscrm.SelectionCountExactlyOne",
    description: "One selected row",
  },
  {
    id: "Mscrm.ShowOnQuickAction",
    description: "Show as a quick action",
  },
  {
    id: "Mscrm.ShowOnGrid",
    description: "Show on the grid only",
  },
  {
    id: "Mscrm.ShowOnGridAndQuickAction",
    description: "Show on the grid and quick action",
  },
];

const BUILT_IN_ENABLE_RULE_IDS = new Set(BUILT_IN_ENABLE_RULES.map((rule) => rule.id));

export function isBuiltInEnableRule(id: string): boolean {
  return BUILT_IN_ENABLE_RULE_IDS.has(id);
}
