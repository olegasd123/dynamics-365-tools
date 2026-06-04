export type RibbonScope = "Application" | "Form" | "HomepageGrid" | "SubGrid";

export type RibbonSourceKind = "unpacked" | "flat" | "zip";

export type RibbonRuleAppliesTo = "PrimaryEntity" | "SelectedEntity";

export type RibbonRulePrivilegeType =
  | "Create"
  | "Read"
  | "Write"
  | "Delete"
  | "Assign"
  | "Share"
  | "Append"
  | "AppendTo";

export type RibbonRulePrivilegeDepth = "None" | "Basic" | "Local" | "Deep" | "Global";

export type RibbonRuleFormState = "Create" | "Existing" | "ReadOnly" | "Disabled" | "BulkEdit";

export type RibbonRuleFormType =
  | "Main"
  | "Preview"
  | "AppointmentBook"
  | "Dashboard"
  | "Quick"
  | "QuickCreate"
  | "Card"
  | "MainInteractionCentric"
  | string;

export type RibbonEntityPropertyName =
  | "DuplicateDetectionEnabled"
  | "GridFiltersEnabled"
  | "HasStateCode"
  | "IsConnectionsEnabled"
  | "MailMergeEnabled"
  | "WorksWithQueue"
  | "HasActivities"
  | "IsActivity"
  | "HasNotes"
  | "IsActivityParty"
  | "HasEmailAddresses"
  | "IsChildEntity"
  | "IsImportable"
  | "IsEnabledForCharts"
  | "IsBusinessProcessEnabled"
  | "HasFeedback"
  | "IsBPFEntity"
  | string;

export type RibbonOrganizationSetting =
  | "IsSharepointEnabled"
  | "IsSOPIntegrationEnabled"
  | "IsFiscalCalendarDefined"
  | "IsReadFormModeDefined"
  | "IsBPFEntityCustomizationFeatureEnabled"
  | string;

export type RibbonCommandClientType = "Modern" | "Refresh" | "Legacy";

export interface RibbonSource {
  id: string;
  kind: RibbonSourceKind;
  name: string;
  rootUri: string;
  files: RibbonSourceFile[];
  zip?: RibbonZipSource;
}

export interface RibbonZipSource {
  originalZipUri?: string;
  extractedRootUri: string;
  entries: string[];
}

export interface RibbonSourceFile {
  fileUri: string;
  kind: "Application" | "Entity" | "Flat";
  entityLogicalName?: string;
}

export interface TextRange {
  start: number;
  end: number;
}

export interface RibbonSectionRanges {
  customActions?: TextRange;
  templates?: TextRange;
  commandDefinitions?: TextRange;
  ruleDefinitions?: TextRange;
  locLabels?: TextRange;
}

export interface XmlAttributeRange {
  name: string;
  value: string;
  range: TextRange;
  valueRange: TextRange;
}

export interface XmlElementRange {
  name: string;
  range: TextRange;
  startTagRange: TextRange;
  endTagRange?: TextRange;
  innerRange: TextRange;
  attributes: XmlAttributeRange[];
  children: XmlElementRange[];
  selfClosing: boolean;
}

export interface RibbonDocument {
  id: string;
  sourceId: string;
  kind: "Application" | "Entity";
  entityLogicalName?: string;
  fileUri: string;
  sourceText: string;
  ribbonRange: TextRange;
  sections: RibbonSectionRanges;
  views: RibbonView[];
}

export interface RibbonView {
  scope: RibbonScope;
  customActions: CustomAction[];
  hideActions: HideAction[];
  commandDefinitions: CommandDefinition[];
  enableRules: EnableRule[];
  displayRules: DisplayRule[];
  locLabels: LocLabel[];
  templatesRange?: TextRange;
  unknownNodeRanges: TextRange[];
}

export interface CustomAction {
  id: string;
  location: string;
  sequence?: number;
  commandUI?: ButtonNode | GroupNode | TabNode | MenuSectionNode | UnknownCommandUINode;
  range: TextRange;
}

export interface ButtonNode {
  kind: "Button";
  id: string;
  command: string;
  labelLocId?: string;
  labelText?: string;
  alt?: string;
  toolTipTitle?: string;
  toolTipDescription?: string;
  toolTipTitleLocId?: string;
  toolTipDescriptionLocId?: string;
  image16x16?: ImageRef;
  image32x32?: ImageRef;
  modernImage?: ImageRef;
  templateAlias?: string;
  sequence?: number;
  range: TextRange;
}

export interface GroupNode {
  kind: "Group";
  id: string;
  command?: string;
  title?: string;
  sequence?: number;
  range: TextRange;
}

export interface TabNode {
  kind: "Tab";
  id: string;
  command?: string;
  title?: string;
  sequence?: number;
  range: TextRange;
}

export interface MenuSectionNode {
  kind: "MenuSection";
  id: string;
  sequence?: number;
  range: TextRange;
}

export interface UnknownCommandUINode {
  kind: "Unknown";
  name: string;
  raw: string;
  range: TextRange;
}

export interface ImageRef {
  webResourceUniqueName: string;
}

export interface HideAction {
  hideActionId: string;
  location: string;
  range: TextRange;
}

export interface CommandDefinition {
  id: string;
  enableRuleRefs: string[];
  displayRuleRefs: string[];
  actions: CommandAction[];
  range: TextRange;
}

export type CommandAction =
  | {
      kind: "JavaScriptFunction";
      library: WebResourceRef;
      functionName: string;
      parameters: ActionParameter[];
      range: TextRange;
    }
  | {
      kind: "Url";
      address: string;
      passParams?: boolean;
      winMode?: number;
      winParams?: string;
      parameters: ActionParameter[];
      range: TextRange;
    }
  | { kind: "Unknown"; raw: string; range: TextRange };

export interface WebResourceRef {
  uniqueName: string;
  workspaceUri?: string;
}

export interface ActionParameter {
  kind: "Crm" | "Bool" | "Int" | "Float" | "String" | "Decimal";
  value: string;
  name?: string;
  range?: TextRange;
}

export interface EnableRule {
  id: string;
  steps: RuleStep[];
  range: TextRange;
}

export interface DisplayRule {
  id: string;
  steps: RuleStep[];
  range: TextRange;
}

export type RuleStep =
  | {
      kind: "CustomRule";
      library: WebResourceRef;
      functionName: string;
      default?: boolean;
      invertResult?: boolean;
      parameters: ActionParameter[];
      range: TextRange;
    }
  | {
      kind: "EntityPrivilegeRule";
      entityName?: string;
      privilegeType?: RibbonRulePrivilegeType;
      privilegeDepth?: RibbonRulePrivilegeDepth;
      appliesTo?: RibbonRuleAppliesTo;
      default?: boolean;
      invertResult?: boolean;
      range: TextRange;
    }
  | {
      kind: "ValueRule";
      field?: string;
      value?: string;
      default?: boolean;
      invertResult?: boolean;
      range: TextRange;
    }
  | {
      kind: "FormStateRule";
      state?: RibbonRuleFormState;
      default?: boolean;
      invertResult?: boolean;
      range: TextRange;
    }
  | {
      kind: "CommandClientTypeRule";
      type?: RibbonCommandClientType;
      default?: boolean;
      invertResult?: boolean;
      range: TextRange;
    }
  | {
      kind: "FormTypeRule";
      type?: RibbonRuleFormType;
      default?: boolean;
      invertResult?: boolean;
      range: TextRange;
    }
  | {
      kind: "EntityPropertyRule";
      propertyName?: RibbonEntityPropertyName;
      propertyValue?: boolean;
      default?: boolean;
      invertResult?: boolean;
      range: TextRange;
    }
  | {
      kind: "MiscellaneousPrivilegeRule";
      privilegeName?: string;
      privilegeDepth?: RibbonRulePrivilegeDepth;
      default?: boolean;
      invertResult?: boolean;
      range: TextRange;
    }
  | {
      kind: "OrganizationSettingRule";
      setting?: RibbonOrganizationSetting;
      default?: boolean;
      invertResult?: boolean;
      range: TextRange;
    }
  | {
      kind: "HideForTabletExperienceRule";
      default?: boolean;
      invertResult?: boolean;
      range: TextRange;
    }
  | {
      kind: "SelectionCountRule";
      appliesTo?: RibbonRuleAppliesTo;
      minimum?: number;
      maximum?: number;
      default?: boolean;
      invertResult?: boolean;
      range: TextRange;
    }
  | {
      kind: "RecordPrivilegeRule";
      privilegeType?: RibbonRulePrivilegeType;
      appliesTo?: "PrimaryEntity";
      default?: boolean;
      invertResult?: boolean;
      range: TextRange;
    }
  | {
      kind: "EntityRule";
      entityName?: string;
      appliesTo?: RibbonRuleAppliesTo;
      context?: string;
      default?: boolean;
      invertResult?: boolean;
      range: TextRange;
    }
  | { kind: "Unknown"; raw: string; range: TextRange };

export interface LocLabel {
  id: string;
  titles: LocLabelTitle[];
  range: TextRange;
}

export interface LocLabelTitle {
  languageCode: number;
  description: string;
  range: TextRange;
}

export type RibbonPatch =
  | { kind: "insert"; offset: number; text: string }
  | { kind: "replace"; range: TextRange; text: string }
  | { kind: "delete"; range: TextRange };
