import * as vscode from "vscode";
import { CommandContext } from "@app/commandContext";
import {
  RibbonCommandClientType,
  RibbonEntityPropertyName,
  RibbonOrganizationSetting,
  RibbonPageRuleAddress,
  RibbonRelationshipType,
  RibbonRuleAppliesTo,
  RibbonRuleFormType,
  RibbonRuleFormState,
  RibbonRulePrivilegeDepth,
  RibbonRulePrivilegeType,
} from "../models";
import { NewRuleStepInput } from "../ribbonEditPatches";
import type { RibbonDocument } from "../models";
import { promptJavaScriptAction } from "./ribbonActionPrompts";
import { pickRibbonEntityLogicalName, pickRibbonFieldLogicalName } from "./ribbonMetadataPrompts";
import { showRibbonInputBox, showRibbonQuickPick } from "./ribbonPromptUi";

type SelectionCountCondition =
  | "EqualTo"
  | "GreaterThan"
  | "GreaterThanOrEqual"
  | "LessThan"
  | "LessThanOrEqual"
  | "Between";

interface SelectionCountConditionPick extends vscode.QuickPickItem {
  condition: SelectionCountCondition;
}

interface RibbonValuePick extends vscode.QuickPickItem {
  value?: string;
  manual?: boolean;
}

const FORM_TYPE_RULE_TYPES = [
  "Main",
  "Preview",
  "AppointmentBook",
  "Dashboard",
  "Quick",
  "QuickCreate",
  "Card",
  "MainInteractionCentric",
];
const ENTITY_PROPERTY_RULE_PROPERTIES = [
  "DuplicateDetectionEnabled",
  "GridFiltersEnabled",
  "HasStateCode",
  "IsConnectionsEnabled",
  "MailMergeEnabled",
  "WorksWithQueue",
  "HasActivities",
  "IsActivity",
  "HasNotes",
  "IsActivityParty",
  "HasEmailAddresses",
  "IsChildEntity",
  "IsImportable",
  "IsEnabledForCharts",
  "IsBusinessProcessEnabled",
  "HasFeedback",
  "IsBPFEntity",
];
const MISCELLANEOUS_PRIVILEGE_RULE_NAMES = ["ExportToExcel", "MailMerge", "GoOffline"];
const ORGANIZATION_SETTING_RULE_SETTINGS = [
  "IsSharepointEnabled",
  "IsSOPIntegrationEnabled",
  "IsFiscalCalendarDefined",
  "IsReadFormModeDefined",
  "IsBPFEntityCustomizationFeatureEnabled",
];
const RELATIONSHIP_TYPE_RULE_TYPES = ["OneToMany", "ManyToMany"];

export async function promptRuleStep(
  ctx: CommandContext,
  ruleKind: "Enable" | "Display",
  document?: RibbonDocument,
): Promise<NewRuleStepInput | null | undefined> {
  const common = [
    { label: "CustomRule", description: "Call a JavaScript function" },
    { label: "FormStateRule", description: "Check form state" },
    { label: "CommandClientTypeRule", description: "Check client type" },
    { label: "ValueRule", description: "Check a field value" },
    { label: "EntityRule", description: "Check table or context" },
  ];
  const displayOnly = [
    { label: "OrRule", description: "Match one child rule" },
    { label: "EntityPrivilegeRule", description: "Check entity privilege" },
    { label: "FormTypeRule", description: "Check form type" },
    { label: "EntityPropertyRule", description: "Check table property" },
    { label: "MiscellaneousPrivilegeRule", description: "Check global privilege" },
    { label: "OrganizationSettingRule", description: "Check organization setting" },
    { label: "HideForTabletExperienceRule", description: "Hide for tablet experience" },
    { label: "RelationshipTypeRule", description: "Check relationship type" },
    {
      label: "ReferencingAttributeRequiredRule",
      description: "Check if the referencing attribute is required",
    },
    { label: "PageRule", description: "Check page address" },
  ];
  const enableOnly = [
    { label: "SelectionCountRule", description: "Check selected rows" },
    { label: "RecordPrivilegeRule", description: "Check record privilege" },
  ];
  const pick = await showRibbonQuickPick(
    [
      ...(ruleKind === "Enable" ? enableOnly : []),
      ...(ruleKind === "Display" ? displayOnly : []),
      ...common,
      { label: "No step", description: "Create an empty rule" },
    ],
    { placeHolder: "First rule step" },
  );
  if (!pick) {
    return undefined;
  }

  switch (pick.label) {
    case "No step":
      return null;
    case "CustomRule":
      return promptCustomRuleStep(ctx);
    case "FormStateRule":
      return promptFormStateRuleStep();
    case "CommandClientTypeRule":
      return promptCommandClientTypeRuleStep();
    case "ValueRule":
      return promptValueRuleStep(ctx, document);
    case "EntityPrivilegeRule":
      return promptEntityPrivilegeRuleStep(ctx);
    case "FormTypeRule":
      return promptFormTypeRuleStep();
    case "EntityPropertyRule":
      return promptEntityPropertyRuleStep();
    case "MiscellaneousPrivilegeRule":
      return promptMiscellaneousPrivilegeRuleStep();
    case "OrganizationSettingRule":
      return promptOrganizationSettingRuleStep();
    case "HideForTabletExperienceRule":
      return promptHideForTabletExperienceRuleStep();
    case "RelationshipTypeRule":
      return promptRelationshipTypeRuleStep();
    case "ReferencingAttributeRequiredRule":
      return promptReferencingAttributeRequiredRuleStep();
    case "PageRule":
      return promptPageRuleStep();
    case "OrRule":
      return { kind: "OrRule" };
    case "SelectionCountRule":
      return promptSelectionCountRuleStep();
    case "RecordPrivilegeRule":
      return promptRecordPrivilegeRuleStep();
    case "EntityRule":
      return promptEntityRuleStep(ctx, document);
    default:
      return undefined;
  }
}

async function promptCustomRuleStep(ctx: CommandContext): Promise<NewRuleStepInput | undefined> {
  const action = await promptJavaScriptAction(ctx);
  if (!action || action.kind !== "JavaScriptFunction") {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return {
    kind: "CustomRule",
    library: action.library,
    functionName: action.functionName,
    parameters: action.parameters,
    invertResult,
  };
}

async function promptFormStateRuleStep(): Promise<NewRuleStepInput | undefined> {
  const state = (await showRibbonQuickPick(
    ["Create", "Existing", "ReadOnly", "Disabled", "BulkEdit"],
    { placeHolder: "Form state" },
  )) as RibbonRuleFormState | undefined;
  if (!state) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return { kind: "FormStateRule", state, invertResult };
}

async function promptCommandClientTypeRuleStep(): Promise<NewRuleStepInput | undefined> {
  const type = (await showRibbonQuickPick(["Modern", "Refresh", "Legacy"], {
    placeHolder: "Client type",
  })) as RibbonCommandClientType | undefined;
  return type ? { kind: "CommandClientTypeRule", type } : undefined;
}

async function promptValueRuleStep(
  ctx: CommandContext,
  document: RibbonDocument | undefined,
): Promise<NewRuleStepInput | undefined> {
  const field = await pickRibbonFieldLogicalName(ctx, document, {
    prompt: "Field name",
    required: true,
  });
  if (!field) {
    return undefined;
  }

  const value = await showRibbonInputBox({
    prompt: "Value",
    validateInput: (input) => (input.trim() ? undefined : "Value is required."),
  });
  if (!value) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return { kind: "ValueRule", field: field.trim(), value: value.trim(), invertResult };
}

async function promptEntityPrivilegeRuleStep(
  ctx: CommandContext,
): Promise<NewRuleStepInput | undefined> {
  const privilegeType = (await showRibbonQuickPick(
    ["Create", "Read", "Write", "Delete", "Append", "AppendTo", "Assign", "Share"],
    { placeHolder: "Privilege type" },
  )) as RibbonRulePrivilegeType | undefined;
  if (!privilegeType) {
    return undefined;
  }

  const entityName = await pickRibbonEntityLogicalName(ctx, {
    prompt: "Entity logical name",
    allowEmpty: true,
  });
  if (entityName === undefined) {
    return undefined;
  }
  const privilegeDepth = (await showRibbonQuickPick(["None", "Basic", "Local", "Deep", "Global"], {
    placeHolder: "Privilege depth",
  })) as RibbonRulePrivilegeDepth | undefined;
  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return {
    kind: "EntityPrivilegeRule",
    entityName: entityName?.trim() || undefined,
    privilegeType,
    privilegeDepth,
    invertResult,
  };
}

async function promptFormTypeRuleStep(): Promise<NewRuleStepInput | undefined> {
  const type = await promptKnownOrCustomValue("Form type", FORM_TYPE_RULE_TYPES, "Type form type");
  if (!type) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return { kind: "FormTypeRule", type: type as RibbonRuleFormType, invertResult };
}

async function promptEntityPropertyRuleStep(): Promise<NewRuleStepInput | undefined> {
  const propertyName = await promptKnownOrCustomValue(
    "Entity property",
    ENTITY_PROPERTY_RULE_PROPERTIES,
    "Type entity property",
  );
  if (!propertyName) {
    return undefined;
  }

  const propertyValue = await promptOptionalBoolean("Property value");
  if (propertyValue === undefined) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return {
    kind: "EntityPropertyRule",
    propertyName: propertyName as RibbonEntityPropertyName,
    propertyValue,
    invertResult,
  };
}

async function promptMiscellaneousPrivilegeRuleStep(): Promise<NewRuleStepInput | undefined> {
  const privilegeName = await promptKnownOrCustomValue(
    "Privilege name",
    MISCELLANEOUS_PRIVILEGE_RULE_NAMES,
    "Type privilege name",
  );
  if (!privilegeName) {
    return undefined;
  }

  const privilegeDepth = (await showRibbonQuickPick(
    ["No value", "None", "Basic", "Local", "Deep", "Global"],
    {
      placeHolder: "Privilege depth",
    },
  )) as RibbonRulePrivilegeDepth | "No value" | undefined;
  if (!privilegeDepth) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return {
    kind: "MiscellaneousPrivilegeRule",
    privilegeName,
    privilegeDepth: privilegeDepth === "No value" ? undefined : privilegeDepth,
    invertResult,
  };
}

async function promptOrganizationSettingRuleStep(): Promise<NewRuleStepInput | undefined> {
  const setting = await promptKnownOrCustomValue(
    "Organization setting",
    ORGANIZATION_SETTING_RULE_SETTINGS,
    "Type organization setting",
  );
  if (!setting) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return {
    kind: "OrganizationSettingRule",
    setting: setting as RibbonOrganizationSetting,
    invertResult,
  };
}

async function promptHideForTabletExperienceRuleStep(): Promise<NewRuleStepInput | undefined> {
  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return { kind: "HideForTabletExperienceRule", invertResult };
}

async function promptRelationshipTypeRuleStep(): Promise<NewRuleStepInput | undefined> {
  const type = await promptKnownOrCustomValue(
    "Relationship type",
    RELATIONSHIP_TYPE_RULE_TYPES,
    "Type relationship type",
  );
  if (!type) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return { kind: "RelationshipTypeRule", type: type as RibbonRelationshipType, invertResult };
}

async function promptReferencingAttributeRequiredRuleStep(): Promise<NewRuleStepInput | undefined> {
  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return { kind: "ReferencingAttributeRequiredRule", invertResult };
}

async function promptPageRuleStep(): Promise<NewRuleStepInput | undefined> {
  const address = await showRibbonInputBox({
    prompt: "Page address",
    placeHolder: "/dashboards/dashboard.aspx",
    validateInput: (value) => (value.trim() ? undefined : "Page address is required."),
  });
  if (!address) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return { kind: "PageRule", address: address.trim() as RibbonPageRuleAddress, invertResult };
}

async function promptSelectionCountRuleStep(): Promise<NewRuleStepInput | undefined> {
  const appliesTo = await promptAppliesTo("Applies to");
  if (appliesTo === undefined) {
    return undefined;
  }

  const condition = await showRibbonQuickPick<SelectionCountConditionPick>(
    [
      { label: "Equal to", description: "= selected rows", condition: "EqualTo" },
      { label: "Greater than", description: "> selected rows", condition: "GreaterThan" },
      {
        label: "Greater than or equal",
        description: ">= selected rows",
        condition: "GreaterThanOrEqual",
      },
      { label: "Less than", description: "< selected rows", condition: "LessThan" },
      {
        label: "Less than or equal",
        description: "<= selected rows",
        condition: "LessThanOrEqual",
      },
      { label: "Between", description: "Minimum and maximum selected rows", condition: "Between" },
    ],
    { placeHolder: "Selected row condition" },
  );
  if (!condition) {
    return undefined;
  }

  const bounds = await promptSelectionCountBounds(condition.condition);
  if (!bounds) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return {
    kind: "SelectionCountRule",
    appliesTo: appliesTo ?? undefined,
    minimum: bounds.minimum,
    maximum: bounds.maximum,
    invertResult,
  };
}

async function promptSelectionCountBounds(
  condition: SelectionCountCondition,
): Promise<{ minimum?: number; maximum?: number } | undefined> {
  switch (condition) {
    case "EqualTo": {
      const count = await promptRequiredInteger("Selected rows", "1");
      return count === undefined ? undefined : { minimum: count, maximum: count };
    }
    case "GreaterThan": {
      const count = await promptRequiredInteger("Selected rows", "1");
      return count === undefined ? undefined : { minimum: count + 1 };
    }
    case "GreaterThanOrEqual": {
      const count = await promptRequiredInteger("Selected rows", "1");
      return count === undefined ? undefined : { minimum: count };
    }
    case "LessThan": {
      const count = await promptRequiredInteger("Selected rows", "1", 1);
      return count === undefined ? undefined : { maximum: count - 1 };
    }
    case "LessThanOrEqual": {
      const count = await promptRequiredInteger("Selected rows", "1");
      return count === undefined ? undefined : { maximum: count };
    }
    case "Between": {
      const minimum = await promptRequiredInteger("Minimum selected rows", "1");
      if (minimum === undefined) {
        return undefined;
      }
      const maximum = await promptRequiredInteger(
        "Maximum selected rows",
        minimum.toString(),
        minimum,
      );
      return maximum === undefined ? undefined : { minimum, maximum };
    }
  }
}

async function promptRecordPrivilegeRuleStep(): Promise<NewRuleStepInput | undefined> {
  const privilegeType = (await showRibbonQuickPick(
    ["Create", "Read", "Write", "Delete", "Append", "AppendTo", "Assign", "Share"],
    { placeHolder: "Privilege type" },
  )) as RibbonRulePrivilegeType | undefined;
  if (!privilegeType) {
    return undefined;
  }

  const appliesTo = (await showRibbonQuickPick(["PrimaryEntity", "No value"], {
    placeHolder: "Applies to",
  })) as "PrimaryEntity" | "No value" | undefined;
  if (!appliesTo) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return {
    kind: "RecordPrivilegeRule",
    privilegeType,
    appliesTo: appliesTo === "No value" ? undefined : appliesTo,
    invertResult,
  };
}

async function promptEntityRuleStep(
  ctx: CommandContext,
  document: RibbonDocument | undefined,
): Promise<NewRuleStepInput | undefined> {
  const entityName = await pickRibbonEntityLogicalName(ctx, {
    prompt: "Entity logical name",
    currentValue: document?.entityLogicalName,
    allowEmpty: true,
  });
  if (entityName === undefined) {
    return undefined;
  }

  const appliesTo = await promptAppliesTo("Applies to");
  if (appliesTo === undefined) {
    return undefined;
  }

  const context = await showRibbonInputBox({
    prompt: "Context",
    placeHolder: "Form",
  });
  if (context === undefined) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return {
    kind: "EntityRule",
    entityName: entityName.trim() || undefined,
    appliesTo: appliesTo ?? undefined,
    context: context.trim() || undefined,
    invertResult,
  };
}

async function promptAppliesTo(prompt: string): Promise<RibbonRuleAppliesTo | null | undefined> {
  const appliesTo = (await showRibbonQuickPick(["SelectedEntity", "PrimaryEntity", "No value"], {
    placeHolder: prompt,
  })) as RibbonRuleAppliesTo | "No value" | undefined;

  if (!appliesTo) {
    return undefined;
  }

  return appliesTo === "No value" ? null : appliesTo;
}

async function promptRequiredInteger(
  prompt: string,
  placeHolder: string,
  minimum = 0,
): Promise<number | undefined> {
  const value = await showRibbonInputBox({
    prompt,
    placeHolder,
    validateInput: (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        return "Value is required.";
      }
      if (!/^\d+$/.test(trimmed)) {
        return "Use a whole number.";
      }
      return Number(trimmed) >= minimum ? undefined : `Use ${minimum} or more.`;
    },
  });
  if (value === undefined) {
    return undefined;
  }

  return Number(value.trim());
}

async function promptKnownOrCustomValue(
  placeHolder: string,
  values: string[],
  manualLabel: string,
): Promise<string | undefined> {
  const pick = await showRibbonQuickPick<RibbonValuePick>(
    [
      ...values.map((value) => ({ label: value, value })),
      {
        label: manualLabel,
        description: "Type a custom value",
        manual: true,
      },
    ],
    { placeHolder },
  );
  if (!pick) {
    return undefined;
  }

  if (!pick.manual) {
    return pick.value ?? pick.label;
  }

  const value = await showRibbonInputBox({
    prompt: placeHolder,
    validateInput: (input) => (input.trim() ? undefined : "Value is required."),
  });
  return value?.trim() || undefined;
}

async function promptOptionalBoolean(prompt: string): Promise<boolean | undefined> {
  const pick = await showRibbonQuickPick(["No", "Yes"], { placeHolder: prompt });
  if (!pick) {
    return undefined;
  }

  return pick === "Yes";
}
