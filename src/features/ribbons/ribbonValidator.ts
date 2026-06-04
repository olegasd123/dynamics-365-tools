import {
  ButtonNode,
  CommandAction,
  CommandDefinition,
  CustomAction,
  DisplayRule,
  EnableRule,
  ActionParameter,
  LocLabel,
  RibbonDocument,
  RibbonView,
  RuleStep,
  TextRange,
} from "./models";
import { isBuiltInEnableRule } from "./enableRuleCatalog";
import { findOobRibbonCommand } from "./oobCatalog";

export type RibbonValidationSeverity = "error" | "warning";

export interface RibbonValidationIssue {
  severity: RibbonValidationSeverity;
  message: string;
  range: TextRange;
}

const KNOWN_CRM_PARAMETERS = new Set([
  "PrimaryControl",
  "SelectedControl",
  "SelectedControlSelectedItemCount",
  "SelectedControlSelectedItemIds",
  "SelectedControlSelectedItemReferences",
  "SelectedControlAllItemCount",
  "SelectedControlAllItemIds",
  "SelectedControlAllItemReferences",
  "SelectedControlUnselectedItemCount",
  "SelectedControlUnselectedItemIds",
  "SelectedControlUnselectedItemReferences",
  "SelectedEntityTypeName",
  "FirstPrimaryItemId",
  "PrimaryEntityTypeName",
  "PrimaryItemIds",
  "CommandProperties",
  "OrgName",
  "OrgLcid",
  "UserLcid",
]);

export function validateRibbonDocument(document: RibbonDocument): RibbonValidationIssue[] {
  return document.views.flatMap((view) => validateRibbonView(document, view));
}

function validateRibbonView(document: RibbonDocument, view: RibbonView): RibbonValidationIssue[] {
  const issues: RibbonValidationIssue[] = [];
  const commandIds = new Set(view.commandDefinitions.map((command) => command.id).filter(Boolean));
  const enableRuleIds = new Set(view.enableRules.map((rule) => rule.id).filter(Boolean));
  const displayRuleIds = new Set(view.displayRules.map((rule) => rule.id).filter(Boolean));
  const locLabelIds = new Set(view.locLabels.map((label) => label.id).filter(Boolean));

  issues.push(
    ...validateCustomActions(view.customActions, commandIds, locLabelIds, document, view),
  );
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
  document: RibbonDocument,
  view: RibbonView,
): RibbonValidationIssue[] {
  const issues: RibbonValidationIssue[] = [];

  for (const action of actions) {
    issues.push(...required(action.id, "CustomAction Id", action.range));
    issues.push(...required(action.location, "Location", action.range));

    if (action.commandUI?.kind === "Button") {
      issues.push(...validateButton(action.commandUI, commandIds, locLabelIds, document, view));
    }
  }

  return issues;
}

function validateButton(
  button: ButtonNode,
  commandIds: Set<string>,
  locLabelIds: Set<string>,
  document: RibbonDocument,
  view: RibbonView,
): RibbonValidationIssue[] {
  const issues: RibbonValidationIssue[] = [];
  issues.push(...required(button.id, "Button Id", button.range));
  issues.push(...required(button.command, "Button Command", button.range));

  if (
    button.command &&
    !commandIds.has(button.command) &&
    !isKnownOobCommand(document, view, button.command)
  ) {
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

function isKnownOobCommand(document: RibbonDocument, view: RibbonView, commandId: string): boolean {
  return Boolean(
    findOobRibbonCommand(commandId, document.entityLogicalName)?.scopes.includes(view.scope),
  );
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
    .filter((id) => id && !knownIds.has(id) && !isKnownBuiltInRuleRef(label, id))
    .map((id) => ({
      severity: "error" as const,
      message: `CommandDefinition references missing ${label} '${id}'.`,
      range,
    }));
}

function isKnownBuiltInRuleRef(label: "EnableRule" | "DisplayRule", id: string): boolean {
  return label === "EnableRule" && isBuiltInEnableRule(id);
}

function validateCommandAction(action: CommandAction): RibbonValidationIssue[] {
  if (action.kind === "JavaScriptFunction") {
    return [
      ...required(action.library.uniqueName, "JavaScript library", action.range),
      ...required(action.functionName, "JavaScript function name", action.range),
      ...validateActionParameters(action.parameters),
    ];
  }

  if (action.kind === "Url") {
    return [
      ...required(action.address, "URL address", action.range),
      ...validateActionParameters(action.parameters),
      ...action.parameters
        .filter((parameter) => !parameter.name)
        .map((parameter) => ({
          severity: "error" as const,
          message: "URL action parameter name is required.",
          range: parameter.range ?? action.range,
        })),
    ];
  }

  return [];
}

function validateActionParameters(parameters: ActionParameter[]): RibbonValidationIssue[] {
  return parameters
    .filter((parameter) => parameter.kind === "Crm" && !KNOWN_CRM_PARAMETERS.has(parameter.value))
    .map((parameter) => ({
      severity: "warning" as const,
      message: `Unknown CRM parameter '${parameter.value}'.`,
      range: parameter.range ?? { start: 0, end: 0 },
    }));
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
  switch (step.kind) {
    case "CustomRule":
      return [
        ...required(step.library.uniqueName, "CustomRule library", step.range),
        ...required(step.functionName, "CustomRule function name", step.range),
      ];
    case "ValueRule":
      return [
        ...required(step.field, "ValueRule field", step.range),
        ...required(step.value, "ValueRule value", step.range),
      ];
    case "FormStateRule":
      return required(step.state, "FormStateRule state", step.range);
    case "CommandClientTypeRule":
      return required(step.type, "CommandClientTypeRule type", step.range);
    case "FormTypeRule":
      return required(step.type, "FormTypeRule type", step.range);
    case "EntityPropertyRule":
      return [
        ...required(step.propertyName, "EntityPropertyRule property name", step.range),
        ...requiredBoolean(step.propertyValue, "EntityPropertyRule property value", step.range),
      ];
    case "MiscellaneousPrivilegeRule":
      return required(step.privilegeName, "MiscellaneousPrivilegeRule privilege name", step.range);
    case "OrganizationSettingRule":
      return required(step.setting, "OrganizationSettingRule setting", step.range);
    case "HideForTabletExperienceRule":
      return [];
    case "EntityPrivilegeRule":
      return [
        ...required(step.privilegeType, "EntityPrivilegeRule privilege type", step.range),
        ...required(step.privilegeDepth, "EntityPrivilegeRule privilege depth", step.range),
      ];
    case "RecordPrivilegeRule":
      return required(step.privilegeType, "RecordPrivilegeRule privilege type", step.range);
    case "SelectionCountRule":
      return step.minimum === undefined && step.maximum === undefined
        ? [
            {
              severity: "error",
              message: "SelectionCountRule minimum or maximum is required.",
              range: step.range,
            },
          ]
        : [];
    case "EntityRule":
      return [];
    case "Unknown":
      return [];
  }
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

function requiredBoolean(
  value: boolean | undefined,
  label: string,
  range: TextRange,
): RibbonValidationIssue[] {
  return value === undefined
    ? [
        {
          severity: "error",
          message: `${label} is required.`,
          range,
        },
      ]
    : [];
}
