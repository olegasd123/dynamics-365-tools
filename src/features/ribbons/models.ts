export type RibbonScope = "Application" | "Form" | "HomepageGrid" | "SubGrid";

export type RibbonSourceKind = "unpacked" | "flat";

export interface RibbonSource {
  id: string;
  kind: RibbonSourceKind;
  name: string;
  rootUri: string;
  files: RibbonSourceFile[];
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
  toolTipTitleLocId?: string;
  toolTipDescriptionLocId?: string;
  image16x16?: ImageRef;
  image32x32?: ImageRef;
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
  | { kind: "Url"; address: string; range: TextRange }
  | { kind: "Unknown"; raw: string; range: TextRange };

export interface WebResourceRef {
  uniqueName: string;
  workspaceUri?: string;
}

export interface ActionParameter {
  kind: "Crm" | "Bool" | "Int" | "Float" | "String" | "Decimal";
  value: string;
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
      privilegeType?: string;
      privilegeDepth?: string;
      invertResult?: boolean;
      range: TextRange;
    }
  | { kind: "ValueRule"; field?: string; value?: string; invertResult?: boolean; range: TextRange }
  | { kind: "FormStateRule"; state?: string; invertResult?: boolean; range: TextRange }
  | { kind: "CommandClientTypeRule"; type?: "Modern" | "Refresh"; range: TextRange }
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
