import * as vscode from "vscode";
import { ConfigurationService } from "../config/configurationService";
import {
  ActionParameter,
  CommandAction,
  CommandDefinition,
  CustomAction,
  DisplayRule,
  EnableRule,
  HideAction,
  LocLabel,
  LocLabelTitle,
  RibbonDocument,
  RibbonSource,
  RibbonView,
  RuleStep,
  TextRange,
  XmlElementRange,
} from "./models";
import { RibbonDiagnosticsService } from "./ribbonDiagnostics";
import { RibbonEditorState } from "./ribbonEditorState";
import { RibbonSourceLocator } from "./ribbonSourceLocator";
import { findOobRibbonCommand } from "./oobCatalog";
import { scanXmlElements } from "./ribbonXmlReader";

export type RibbonExplorerNode =
  | RibbonSourceNode
  | RibbonDocumentNode
  | RibbonViewNode
  | RibbonSectionNode
  | RibbonItemNode
  | RibbonEmptyNode;

export type RibbonDetailValue = string | number | string[] | undefined;

type RibbonSectionKind =
  | "customActions"
  | "hideActions"
  | "commandDefinitions"
  | "enableRules"
  | "displayRules"
  | "locLabels"
  | "templates"
  | "unknownXml";

export class RibbonSourceNode extends vscode.TreeItem {
  readonly contextValue: string;

  constructor(
    readonly source: RibbonSource,
    dirty = false,
  ) {
    super(source.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = dirty
      ? `d365RibbonSource:${source.kind}:dirty`
      : `d365RibbonSource:${source.kind}`;
    this.iconPath = new vscode.ThemeIcon(sourceIcon(source));
    this.description = `${sourceDescription(source)}${dirty ? " *" : ""}`;
    this.tooltip = source.rootUri;
  }
}

export class RibbonDocumentNode extends vscode.TreeItem {
  readonly contextValue: string;

  constructor(
    readonly document: RibbonDocument,
    dirty = false,
  ) {
    super(documentLabel(document), vscode.TreeItemCollapsibleState.Collapsed);
    const kind = document.kind === "Application" ? "application" : "entity";
    this.contextValue = dirty ? `d365RibbonDocument:${kind}:dirty` : `d365RibbonDocument:${kind}`;
    this.iconPath = new vscode.ThemeIcon(document.kind === "Application" ? "globe" : "file-code");
    this.description = `${document.kind === "Application" ? "Application" : "Entity"}${dirty ? " *" : ""}`;
    this.tooltip = document.fileUri;
    this.resourceUri = vscode.Uri.file(document.fileUri);
  }
}

export class RibbonViewNode extends vscode.TreeItem {
  readonly contextValue = "d365RibbonView";

  constructor(
    readonly document: RibbonDocument,
    readonly view: RibbonView,
  ) {
    super(view.scope, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon("list-tree");
  }
}

export class RibbonSectionNode extends vscode.TreeItem {
  readonly contextValue: string;

  constructor(
    readonly document: RibbonDocument,
    readonly view: RibbonView,
    readonly kind: RibbonSectionKind,
    readonly count: number,
  ) {
    super(sectionLabel(kind), vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = `d365RibbonSection:${kind}`;
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon(sectionIcon(kind));
  }
}

export class RibbonItemNode extends vscode.TreeItem {
  readonly contextValue: string;

  constructor(
    label: string,
    description: string | undefined,
    contextValue: string,
    icon: string,
    readonly details: Array<[string, RibbonDetailValue]>,
    readonly children: RibbonExplorerNode[] = [],
    readonly editTarget?: RibbonItemEditTarget,
  ) {
    super(
      label,
      children.length
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.description = description;
    this.contextValue = contextValue;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export interface RibbonItemEditTarget {
  document: RibbonDocument;
  range: TextRange;
}

export class RibbonEmptyNode extends vscode.TreeItem {
  readonly contextValue = "d365RibbonEmpty";

  constructor(label = "No ribbons found", description = "Open an unpacked solution workspace") {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon("search");
  }
}

export class RibbonExplorerProvider implements vscode.TreeDataProvider<RibbonExplorerNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    RibbonExplorerNode | undefined | void
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private sources?: RibbonSource[];
  private readonly documentsBySourceId = new Map<string, RibbonDocument[]>();

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly locator: RibbonSourceLocator,
    private readonly editorState: RibbonEditorState,
    private readonly diagnostics?: RibbonDiagnosticsService,
  ) {}

  refresh(node?: RibbonExplorerNode): void {
    if (!node) {
      this.sources = undefined;
      this.documentsBySourceId.clear();
      this.editorState.clearCachedDocuments();
      this.diagnostics?.clear();
    }

    this.onDidChangeTreeDataEmitter.fire(node);
  }

  getTreeItem(element: RibbonExplorerNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RibbonExplorerNode): Promise<RibbonExplorerNode[]> {
    if (!element) {
      const sources = await this.loadSources();
      return sources.length
        ? sources.map(
            (source) => new RibbonSourceNode(source, this.editorState.isSourceDirty(source.id)),
          )
        : [new RibbonEmptyNode()];
    }

    if (element instanceof RibbonSourceNode) {
      return this.loadDocumentNodes(element.source);
    }

    if (element instanceof RibbonDocumentNode) {
      return element.document.kind === "Entity"
        ? element.document.views.map((view) => new RibbonViewNode(element.document, view))
        : buildSectionNodes(element.document, element.document.views[0]);
    }

    if (element instanceof RibbonViewNode) {
      return buildSectionNodes(element.document, element.view);
    }

    if (element instanceof RibbonSectionNode) {
      return buildItemNodes(element);
    }

    if (element instanceof RibbonItemNode) {
      return element.children;
    }

    return [];
  }

  private async loadSources(): Promise<RibbonSource[]> {
    if (!this.sources) {
      this.sources = await this.locator.locate(this.configuration.workspaceRoot);
    }

    return this.sources;
  }

  private async loadDocumentNodes(source: RibbonSource): Promise<RibbonExplorerNode[]> {
    try {
      const documents = await this.loadDocuments(source);
      return documents.length
        ? documents.map(
            (document) =>
              new RibbonDocumentNode(document, this.editorState.isFileDirty(document.fileUri)),
          )
        : [new RibbonEmptyNode("No RibbonDiffXml blocks found", "Check the source files")];
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to load ribbons: ${String(error)}`);
      return [new RibbonEmptyNode("Failed to load ribbons", "See the error notification")];
    }
  }

  private async loadDocuments(source: RibbonSource): Promise<RibbonDocument[]> {
    const cached = this.documentsBySourceId.get(source.id);
    if (cached) {
      return cached;
    }

    const documents = await this.editorState.loadSource(source);
    this.documentsBySourceId.set(source.id, documents);
    this.diagnostics?.validateDocuments([...this.documentsBySourceId.values()].flat());
    return documents;
  }
}

function buildSectionNodes(document: RibbonDocument, view: RibbonView): RibbonSectionNode[] {
  const sections = [
    new RibbonSectionNode(document, view, "customActions", view.customActions.length),
    new RibbonSectionNode(document, view, "hideActions", view.hideActions.length),
    new RibbonSectionNode(document, view, "commandDefinitions", view.commandDefinitions.length),
    new RibbonSectionNode(document, view, "enableRules", view.enableRules.length),
    new RibbonSectionNode(document, view, "displayRules", view.displayRules.length),
    new RibbonSectionNode(document, view, "locLabels", view.locLabels.length),
  ];

  if (view.templatesRange) {
    sections.push(new RibbonSectionNode(document, view, "templates", 1));
  }

  if (view.unknownNodeRanges.length) {
    sections.push(
      new RibbonSectionNode(document, view, "unknownXml", view.unknownNodeRanges.length),
    );
  }

  return sections;
}

function sourceIcon(source: RibbonSource): string {
  switch (source.kind) {
    case "flat":
      return "file-code";
    case "zip":
      return "file-zip";
    case "unpacked":
      return "folder-library";
  }
}

function sourceDescription(source: RibbonSource): string {
  switch (source.kind) {
    case "flat":
      return "flat";
    case "zip":
      return `${source.files.length} files from zip`;
    case "unpacked":
      return `${source.files.length} files`;
  }
}

function buildItemNodes(section: RibbonSectionNode): RibbonExplorerNode[] {
  switch (section.kind) {
    case "customActions":
      return section.view.customActions.map((action) => customActionNode(section.document, action));
    case "hideActions":
      return section.view.hideActions.map((action) => hideActionNode(section.document, action));
    case "commandDefinitions":
      return section.view.commandDefinitions.map((command) =>
        commandDefinitionNode(section.document, command),
      );
    case "enableRules":
      return section.view.enableRules.map((rule) => enableRuleNode(section.document, rule));
    case "displayRules":
      return section.view.displayRules.map((rule) => displayRuleNode(section.document, rule));
    case "locLabels":
      return section.view.locLabels.map((label) => locLabelNode(section.document, label));
    case "templates":
      return section.view.templatesRange
        ? [rawXmlNode(section.document, section.view.templatesRange)]
        : [];
    case "unknownXml":
      return section.view.unknownNodeRanges.map((range) => rawXmlNode(section.document, range));
  }
}

function rawXmlNode(document: RibbonDocument, range: TextRange): RibbonItemNode {
  const name = rawXmlNodeName(document, range);
  return new RibbonItemNode(
    name === "Templates" ? "Templates" : `Unknown XML: ${name}`,
    "Open source XML to edit",
    name === "Templates" ? "d365RibbonTemplates" : "d365RibbonUnknownXml",
    name === "Templates" ? "symbol-namespace" : "warning",
    [
      ["Element", name],
      ["Start", range.start],
      ["End", range.end],
    ],
    [],
    { document, range },
  );
}

function rawXmlNodeName(document: RibbonDocument, range: TextRange): string {
  const element = collectElements(scanXmlElements(document.sourceText)).find((node) =>
    sameRange(node.range, range),
  );

  return element?.name ?? "XML";
}

function customActionNode(document: RibbonDocument, action: CustomAction): RibbonItemNode {
  return new RibbonItemNode(
    action.id,
    action.location ? `@ ${action.location}` : undefined,
    "d365RibbonCustomAction",
    action.commandUI?.kind === "Button" ? "symbol-method" : "symbol-misc",
    [
      ["Id", action.id],
      ["Location", action.location],
      ["Sequence", action.sequence],
      ["UI kind", action.commandUI?.kind],
      ["Command", action.commandUI?.kind === "Button" ? action.commandUI.command : undefined],
    ],
    action.commandUI
      ? [
          new RibbonItemNode(
            `${action.commandUI.kind}: ${commandUiId(action.commandUI)}`,
            action.commandUI.kind === "Button" ? action.commandUI.command : undefined,
            `d365Ribbon${action.commandUI.kind}`,
            action.commandUI.kind === "Button" ? "symbol-method" : "symbol-misc",
            [
              ["Id", commandUiId(action.commandUI)],
              ["Kind", action.commandUI.kind],
              [
                "Command",
                action.commandUI.kind === "Button" ? action.commandUI.command : undefined,
              ],
              [
                "Label",
                action.commandUI.kind === "Button"
                  ? (action.commandUI.labelText ?? action.commandUI.labelLocId)
                  : undefined,
              ],
              ["Sequence", commandUiSequence(action.commandUI)],
            ],
            [],
            { document, range: action.commandUI.range },
          ),
        ]
      : [],
    { document, range: action.range },
  );
}

function commandUiId(commandUI: NonNullable<CustomAction["commandUI"]>): string {
  return commandUI.kind === "Unknown" ? commandUI.name : commandUI.id;
}

function commandUiSequence(commandUI: NonNullable<CustomAction["commandUI"]>): number | undefined {
  return commandUI.kind === "Unknown" ? undefined : commandUI.sequence;
}

function hideActionNode(document: RibbonDocument, action: HideAction): RibbonItemNode {
  return new RibbonItemNode(
    action.hideActionId,
    action.location ? `@ ${action.location}` : undefined,
    "d365RibbonHideAction",
    "eye-closed",
    [
      ["Hide action id", action.hideActionId],
      ["Location", action.location],
    ],
    [],
    { document, range: action.range },
  );
}

function commandDefinitionNode(
  document: RibbonDocument,
  command: CommandDefinition,
): RibbonItemNode {
  const oobCommand = findOobRibbonCommand(command.id, document.entityLogicalName);
  const isOverride = Boolean(oobCommand);

  return new RibbonItemNode(
    isOverride ? `OVERRIDE: ${command.id}` : command.id,
    isOverride
      ? `${command.actions.length} actions • OOB command`
      : `${command.actions.length} actions`,
    "d365RibbonCommandDefinition",
    isOverride ? "debug-rerun" : "gear",
    [
      ["Id", command.id],
      ["Type", isOverride ? "OOB command override" : "Command definition"],
      ["Enable rules", command.enableRuleRefs.join(", ")],
      ["Display rules", command.displayRuleRefs.join(", ")],
      ["Actions", command.actions.length],
    ],
    [
      ruleRefGroupNode(
        document,
        command,
        "EnableRules",
        command.enableRuleRefs,
        "d365RibbonEnableRuleRefs",
      ),
      ruleRefGroupNode(
        document,
        command,
        "DisplayRules",
        command.displayRuleRefs,
        "d365RibbonDisplayRuleRefs",
      ),
      actionGroupNode(document, command),
    ],
    { document, range: command.range },
  );
}

function enableRuleNode(document: RibbonDocument, rule: EnableRule): RibbonItemNode {
  return new RibbonItemNode(
    rule.id,
    `${rule.steps.length} steps`,
    "d365RibbonEnableRule",
    "check",
    [
      ["Id", rule.id],
      ["Steps", rule.steps.map((step) => step.kind).join(", ")],
    ],
    rule.steps.map((step, index) => ruleStepNode(document, step, index)),
    { document, range: rule.range },
  );
}

function displayRuleNode(document: RibbonDocument, rule: DisplayRule): RibbonItemNode {
  return new RibbonItemNode(
    rule.id,
    `${rule.steps.length} steps`,
    "d365RibbonDisplayRule",
    "eye",
    [
      ["Id", rule.id],
      ["Steps", rule.steps.map((step) => step.kind).join(", ")],
    ],
    rule.steps.map((step, index) => ruleStepNode(document, step, index)),
    { document, range: rule.range },
  );
}

function locLabelNode(document: RibbonDocument, label: LocLabel): RibbonItemNode {
  return new RibbonItemNode(
    label.id,
    `${label.titles.length} languages`,
    "d365RibbonLocLabel",
    "symbol-string",
    [
      ["Id", label.id],
      ["Languages", label.titles.map((title) => title.languageCode).join(", ")],
      ["Default text", label.titles[0]?.description],
    ],
    label.titles.map((title) => locLabelTitleNode(document, title)),
    { document, range: label.range },
  );
}

function ruleRefGroupNode(
  document: RibbonDocument,
  command: CommandDefinition,
  label: string,
  refs: string[],
  contextValue: string,
): RibbonItemNode {
  return new RibbonItemNode(
    label,
    String(refs.length),
    contextValue,
    "references",
    [],
    refs.map(ruleRefNode),
    { document, range: command.range },
  );
}

function ruleRefNode(id: string): RibbonItemNode {
  return new RibbonItemNode(id, undefined, "d365RibbonRuleRef", "symbol-key", [["Id", id]]);
}

function actionGroupNode(document: RibbonDocument, command: CommandDefinition): RibbonItemNode {
  return new RibbonItemNode(
    "Actions",
    String(command.actions.length),
    "d365RibbonActions",
    "run",
    [],
    command.actions.map((action, index) => commandActionNode(document, action, index)),
    { document, range: command.range },
  );
}

function commandActionNode(
  document: RibbonDocument,
  action: CommandAction,
  index: number,
): RibbonItemNode {
  if (action.kind === "JavaScriptFunction") {
    return new RibbonItemNode(
      `JavaScript: ${action.functionName}`,
      action.library.uniqueName,
      "d365RibbonJavaScriptAction",
      "symbol-function",
      [
        ["Index", index + 1],
        ["Library", action.library.uniqueName],
        ["Function", action.functionName],
        ["Parameters", parameterValues(action.parameters)],
      ],
      parameterNodes(document, action.parameters),
      { document, range: action.range },
    );
  }

  if (action.kind === "Url") {
    return new RibbonItemNode(
      `Url: ${action.address}`,
      undefined,
      "d365RibbonUrlAction",
      "link",
      [
        ["Index", index + 1],
        ["Address", action.address],
      ],
      [],
      { document, range: action.range },
    );
  }

  return new RibbonItemNode(
    "Unknown action",
    undefined,
    "d365RibbonUnknownAction",
    "warning",
    [
      ["Index", index + 1],
      ["Raw XML", action.raw],
    ],
    [],
    { document, range: action.range },
  );
}

function ruleStepNode(document: RibbonDocument, step: RuleStep, index: number): RibbonItemNode {
  return new RibbonItemNode(
    `${index + 1}. ${step.kind}`,
    ruleStepDescription(step),
    `d365RibbonRuleStep:${step.kind}`,
    step.kind === "Unknown" ? "warning" : "symbol-property",
    ruleStepDetails(step, index),
    step.kind === "CustomRule" ? parameterNodes(document, step.parameters) : [],
    { document, range: step.range },
  );
}

function ruleStepDescription(step: RuleStep): string | undefined {
  switch (step.kind) {
    case "CustomRule":
      return step.functionName;
    case "EntityPrivilegeRule":
      return step.privilegeType;
    case "ValueRule":
      return step.field;
    case "FormStateRule":
      return step.state;
    case "CommandClientTypeRule":
      return step.type;
    case "Unknown":
      return undefined;
  }
}

function ruleStepDetails(step: RuleStep, index: number): Array<[string, RibbonDetailValue]> {
  const base: Array<[string, RibbonDetailValue]> = [
    ["Index", index + 1],
    ["Kind", step.kind],
  ];

  switch (step.kind) {
    case "CustomRule":
      return [
        ...base,
        ["Library", step.library.uniqueName],
        ["Function", step.functionName],
        ["Default", boolText(step.default)],
        ["Invert result", boolText(step.invertResult)],
        ["Parameters", parameterValues(step.parameters)],
      ];
    case "EntityPrivilegeRule":
      return [
        ...base,
        ["Entity", step.entityName],
        ["Privilege", step.privilegeType],
        ["Depth", step.privilegeDepth],
        ["Invert result", boolText(step.invertResult)],
      ];
    case "ValueRule":
      return [
        ...base,
        ["Field", step.field],
        ["Value", step.value],
        ["Invert result", boolText(step.invertResult)],
      ];
    case "FormStateRule":
      return [...base, ["State", step.state], ["Invert result", boolText(step.invertResult)]];
    case "CommandClientTypeRule":
      return [...base, ["Type", step.type]];
    case "Unknown":
      return [...base, ["Raw XML", step.raw]];
  }
}

function parameterNodes(document: RibbonDocument, parameters: ActionParameter[]): RibbonItemNode[] {
  return parameters.map(
    (parameter, index) =>
      new RibbonItemNode(
        `${index + 1}. ${parameter.value}`,
        parameter.kind,
        "d365RibbonParameter",
        "symbol-parameter",
        [
          ["Kind", parameter.kind],
          ["Value", parameter.value],
        ],
        [],
        parameter.range ? { document, range: parameter.range } : undefined,
      ),
  );
}

function parameterValues(parameters: ActionParameter[]): string[] | undefined {
  return parameters.length ? parameters.map((parameter) => parameter.value) : undefined;
}

function locLabelTitleNode(document: RibbonDocument, title: LocLabelTitle): RibbonItemNode {
  return new RibbonItemNode(
    String(title.languageCode),
    title.description,
    "d365RibbonLocLabelTitle",
    "symbol-string",
    [
      ["Language", title.languageCode],
      ["Description", title.description],
    ],
    [],
    { document, range: title.range },
  );
}

function boolText(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function documentLabel(document: RibbonDocument): string {
  return document.kind === "Application"
    ? "Application Ribbon"
    : (document.entityLogicalName ?? "Entity Ribbon");
}

function sectionLabel(kind: RibbonSectionKind): string {
  switch (kind) {
    case "customActions":
      return "Custom Actions";
    case "hideActions":
      return "Hide Actions";
    case "commandDefinitions":
      return "Command Definitions";
    case "enableRules":
      return "Enable Rules";
    case "displayRules":
      return "Display Rules";
    case "locLabels":
      return "Loc Labels";
    case "templates":
      return "Templates";
    case "unknownXml":
      return "Unknown XML";
  }
}

function sectionIcon(kind: RibbonSectionKind): string {
  switch (kind) {
    case "customActions":
      return "tools";
    case "hideActions":
      return "eye-closed";
    case "commandDefinitions":
      return "gear";
    case "enableRules":
      return "check";
    case "displayRules":
      return "eye";
    case "locLabels":
      return "symbol-string";
    case "templates":
      return "symbol-namespace";
    case "unknownXml":
      return "warning";
  }
}

function collectElements(nodes: XmlElementRange[]): XmlElementRange[] {
  const matches: XmlElementRange[] = [];

  for (const node of nodes) {
    matches.push(node);
    matches.push(...collectElements(node.children));
  }

  return matches;
}

function sameRange(left: TextRange, right: TextRange): boolean {
  return left.start === right.start && left.end === right.end;
}
