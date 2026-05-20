import {
  ButtonNode,
  CommandAction,
  CommandDefinition,
  CustomAction,
  DisplayRule,
  EnableRule,
  LocLabel,
  RibbonDocument,
  RibbonView,
  RuleStep,
  TextRange,
} from "./models";

export type RibbonValidationSeverity = "error" | "warning";

export interface RibbonValidationIssue {
  severity: RibbonValidationSeverity;
  message: string;
  range: TextRange;
}

export function validateRibbonDocument(document: RibbonDocument): RibbonValidationIssue[] {
  return document.views.flatMap((view) => validateRibbonView(view));
}

function validateRibbonView(view: RibbonView): RibbonValidationIssue[] {
  const issues: RibbonValidationIssue[] = [];
  const commandIds = new Set(view.commandDefinitions.map((command) => command.id).filter(Boolean));
  const enableRuleIds = new Set(view.enableRules.map((rule) => rule.id).filter(Boolean));
  const displayRuleIds = new Set(view.displayRules.map((rule) => rule.id).filter(Boolean));
  const locLabelIds = new Set(view.locLabels.map((label) => label.id).filter(Boolean));

  issues.push(...validateCustomActions(view.customActions, commandIds, locLabelIds));
  issues.push(
    ...validateUnique(
      "CustomAction",
      view.customActions.map((action) => ({ id: action.id, range: action.range })),
    ),
  );
  issues.push(
    ...validateUnique(
      "HideCustomAction",
      view.hideActions.map((action) => ({ id: action.hideActionId, range: action.range })),
    ),
  );
  issues.push(
    ...view.hideActions.flatMap((action) => required(action.location, "Location", action.range)),
  );
  issues.push(
    ...validateCommandDefinitions(view.commandDefinitions, enableRuleIds, displayRuleIds),
  );
  issues.push(
    ...validateUnique(
      "CommandDefinition",
      view.commandDefinitions.map((command) => ({ id: command.id, range: command.range })),
    ),
  );
  issues.push(...validateRules("EnableRule", view.enableRules));
  issues.push(...validateRules("DisplayRule", view.displayRules));
  issues.push(
    ...validateUnique(
      "EnableRule",
      view.enableRules.map((rule) => ({ id: rule.id, range: rule.range })),
    ),
  );
  issues.push(
    ...validateUnique(
      "DisplayRule",
      view.displayRules.map((rule) => ({ id: rule.id, range: rule.range })),
    ),
  );
  issues.push(...validateLocLabels(view.locLabels));
  issues.push(
    ...validateUnique(
      "LocLabel",
      view.locLabels.map((label) => ({ id: label.id, range: label.range })),
    ),
  );

  return issues;
}

function validateCustomActions(
  actions: CustomAction[],
  commandIds: Set<string>,
  locLabelIds: Set<string>,
): RibbonValidationIssue[] {
  const issues: RibbonValidationIssue[] = [];

  for (const action of actions) {
    issues.push(...required(action.id, "CustomAction Id", action.range));
    issues.push(...required(action.location, "Location", action.range));

    if (action.commandUI?.kind === "Button") {
      issues.push(...validateButton(action.commandUI, commandIds, locLabelIds));
    }
  }

  return issues;
}

function validateButton(
  button: ButtonNode,
  commandIds: Set<string>,
  locLabelIds: Set<string>,
): RibbonValidationIssue[] {
  const issues: RibbonValidationIssue[] = [];
  issues.push(...required(button.id, "Button Id", button.range));
  issues.push(...required(button.command, "Button Command", button.range));

  if (button.command && !commandIds.has(button.command)) {
    issues.push({
      severity: "error",
      message: `Button references missing CommandDefinition '${button.command}'.`,
      range: button.range,
    });
  }

  for (const labelId of [
    button.labelLocId,
    button.toolTipTitleLocId,
    button.toolTipDescriptionLocId,
  ]) {
    if (labelId && !locLabelIds.has(labelId)) {
      issues.push({
        severity: "warning",
        message: `Button references missing LocLabel '${labelId}'.`,
        range: button.range,
      });
    }
  }

  return issues;
}

function validateCommandDefinitions(
  commands: CommandDefinition[],
  enableRuleIds: Set<string>,
  displayRuleIds: Set<string>,
): RibbonValidationIssue[] {
  return commands.flatMap((command) => [
    ...required(command.id, "CommandDefinition Id", command.range),
    ...validateRuleRefs("EnableRule", command.enableRuleRefs, enableRuleIds, command.range),
    ...validateRuleRefs("DisplayRule", command.displayRuleRefs, displayRuleIds, command.range),
    ...command.actions.flatMap(validateCommandAction),
  ]);
}

function validateRuleRefs(
  label: "EnableRule" | "DisplayRule",
  refs: string[],
  knownIds: Set<string>,
  range: TextRange,
): RibbonValidationIssue[] {
  return refs
    .filter((id) => id && !knownIds.has(id))
    .map((id) => ({
      severity: "error" as const,
      message: `CommandDefinition references missing ${label} '${id}'.`,
      range,
    }));
}

function validateCommandAction(action: CommandAction): RibbonValidationIssue[] {
  if (action.kind !== "JavaScriptFunction") {
    return [];
  }

  return [
    ...required(action.library.uniqueName, "JavaScript library", action.range),
    ...required(action.functionName, "JavaScript function name", action.range),
  ];
}

function validateRules(
  label: "EnableRule" | "DisplayRule",
  rules: Array<EnableRule | DisplayRule>,
) {
  return rules.flatMap((rule) => [
    ...required(rule.id, `${label} Id`, rule.range),
    ...rule.steps.flatMap(validateRuleStep),
  ]);
}

function validateRuleStep(step: RuleStep): RibbonValidationIssue[] {
  if (step.kind !== "CustomRule") {
    return [];
  }

  return [
    ...required(step.library.uniqueName, "CustomRule library", step.range),
    ...required(step.functionName, "CustomRule function name", step.range),
  ];
}

function validateLocLabels(labels: LocLabel[]): RibbonValidationIssue[] {
  return labels.flatMap((label) => [
    ...required(label.id, "LocLabel Id", label.range),
    ...(label.titles.length
      ? []
      : [
          {
            severity: "warning" as const,
            message: `LocLabel '${label.id || "(missing id)"}' has no titles.`,
            range: label.range,
          },
        ]),
  ]);
}

function validateUnique(
  label: string,
  items: Array<{ id: string; range: TextRange }>,
): RibbonValidationIssue[] {
  const seen = new Map<string, TextRange>();
  const issues: RibbonValidationIssue[] = [];

  for (const item of items) {
    if (!item.id) {
      continue;
    }

    if (seen.has(item.id)) {
      issues.push({
        severity: "error",
        message: `Duplicate ${label} Id '${item.id}'.`,
        range: item.range,
      });
    } else {
      seen.set(item.id, item.range);
    }
  }

  return issues;
}

function required(
  value: string | undefined,
  label: string,
  range: TextRange,
): RibbonValidationIssue[] {
  return value
    ? []
    : [
        {
          severity: "error",
          message: `${label} is required.`,
          range,
        },
      ];
}
