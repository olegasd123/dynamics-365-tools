import * as vscode from "vscode";
import { ConfigurationService } from "../config/configurationService";
import {
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
} from "./models";
import { RibbonRepository } from "./ribbonRepository";
import { RibbonSourceLocator } from "./ribbonSourceLocator";

export type RibbonExplorerNode =
  | RibbonSourceNode
  | RibbonDocumentNode
  | RibbonViewNode
  | RibbonSectionNode
  | RibbonItemNode
  | RibbonEmptyNode;

type RibbonSectionKind =
  | "customActions"
  | "hideActions"
  | "commandDefinitions"
  | "enableRules"
  | "displayRules"
  | "locLabels";

export class RibbonSourceNode extends vscode.TreeItem {
  readonly contextValue = "d365RibbonSource";

  constructor(readonly source: RibbonSource) {
    super(source.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon(source.kind === "flat" ? "file-code" : "folder-library");
    this.description = source.kind === "flat" ? "flat" : `${source.files.length} files`;
    this.tooltip = source.rootUri;
  }
}

export class RibbonDocumentNode extends vscode.TreeItem {
  readonly contextValue = "d365RibbonDocument";

  constructor(readonly document: RibbonDocument) {
    super(documentLabel(document), vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon(document.kind === "Application" ? "globe" : "file-code");
    this.description = document.kind === "Application" ? "Application" : "Entity";
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
    readonly details: Array<[string, string | number | undefined]>,
    readonly children: RibbonExplorerNode[] = [],
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
    private readonly repository: RibbonRepository,
  ) {}

  refresh(node?: RibbonExplorerNode): void {
    if (!node) {
      this.sources = undefined;
      this.documentsBySourceId.clear();
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
        ? sources.map((source) => new RibbonSourceNode(source))
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
        ? documents.map((document) => new RibbonDocumentNode(document))
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

    const documents = (await this.repository.loadSource(source)).sort(compareDocuments);
    this.documentsBySourceId.set(source.id, documents);
    return documents;
  }
}

function buildSectionNodes(document: RibbonDocument, view: RibbonView): RibbonSectionNode[] {
  return [
    new RibbonSectionNode(document, view, "customActions", view.customActions.length),
    new RibbonSectionNode(document, view, "hideActions", view.hideActions.length),
    new RibbonSectionNode(document, view, "commandDefinitions", view.commandDefinitions.length),
    new RibbonSectionNode(document, view, "enableRules", view.enableRules.length),
    new RibbonSectionNode(document, view, "displayRules", view.displayRules.length),
    new RibbonSectionNode(document, view, "locLabels", view.locLabels.length),
  ];
}

function buildItemNodes(section: RibbonSectionNode): RibbonExplorerNode[] {
  switch (section.kind) {
    case "customActions":
      return section.view.customActions.map(customActionNode);
    case "hideActions":
      return section.view.hideActions.map(hideActionNode);
    case "commandDefinitions":
      return section.view.commandDefinitions.map(commandDefinitionNode);
    case "enableRules":
      return section.view.enableRules.map(enableRuleNode);
    case "displayRules":
      return section.view.displayRules.map(displayRuleNode);
    case "locLabels":
      return section.view.locLabels.map(locLabelNode);
  }
}

function customActionNode(action: CustomAction): RibbonItemNode {
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
          ),
        ]
      : [],
  );
}

function commandUiId(commandUI: NonNullable<CustomAction["commandUI"]>): string {
  return commandUI.kind === "Unknown" ? commandUI.name : commandUI.id;
}

function commandUiSequence(commandUI: NonNullable<CustomAction["commandUI"]>): number | undefined {
  return commandUI.kind === "Unknown" ? undefined : commandUI.sequence;
}

function hideActionNode(action: HideAction): RibbonItemNode {
  return new RibbonItemNode(
    action.hideActionId,
    action.location ? `@ ${action.location}` : undefined,
    "d365RibbonHideAction",
    "eye-closed",
    [
      ["Hide action id", action.hideActionId],
      ["Location", action.location],
    ],
  );
}

function commandDefinitionNode(command: CommandDefinition): RibbonItemNode {
  return new RibbonItemNode(
    command.id,
    `${command.actions.length} actions`,
    "d365RibbonCommandDefinition",
    "gear",
    [
      ["Id", command.id],
      ["Enable rules", command.enableRuleRefs.join(", ")],
      ["Display rules", command.displayRuleRefs.join(", ")],
      ["Actions", command.actions.length],
    ],
    [
      ruleRefGroupNode("EnableRules", command.enableRuleRefs, "d365RibbonEnableRuleRefs"),
      ruleRefGroupNode("DisplayRules", command.displayRuleRefs, "d365RibbonDisplayRuleRefs"),
      actionGroupNode(command.actions),
    ],
  );
}

function enableRuleNode(rule: EnableRule): RibbonItemNode {
  return new RibbonItemNode(
    rule.id,
    `${rule.steps.length} steps`,
    "d365RibbonEnableRule",
    "check",
    [
      ["Id", rule.id],
      ["Steps", rule.steps.map((step) => step.kind).join(", ")],
    ],
    rule.steps.map((step, index) => ruleStepNode(step, index)),
  );
}

function displayRuleNode(rule: DisplayRule): RibbonItemNode {
  return new RibbonItemNode(
    rule.id,
    `${rule.steps.length} steps`,
    "d365RibbonDisplayRule",
    "eye",
    [
      ["Id", rule.id],
      ["Steps", rule.steps.map((step) => step.kind).join(", ")],
    ],
    rule.steps.map((step, index) => ruleStepNode(step, index)),
  );
}

function locLabelNode(label: LocLabel): RibbonItemNode {
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
    label.titles.map(locLabelTitleNode),
  );
}

function ruleRefGroupNode(label: string, refs: string[], contextValue: string): RibbonItemNode {
  return new RibbonItemNode(
    label,
    String(refs.length),
    contextValue,
    "references",
    [],
    refs.map(ruleRefNode),
  );
}

function ruleRefNode(id: string): RibbonItemNode {
  return new RibbonItemNode(id, undefined, "d365RibbonRuleRef", "symbol-key", [["Id", id]]);
}

function actionGroupNode(actions: CommandAction[]): RibbonItemNode {
  return new RibbonItemNode(
    "Actions",
    String(actions.length),
    "d365RibbonActions",
    "run",
    [],
    actions.map((action, index) => commandActionNode(action, index)),
  );
}

function commandActionNode(action: CommandAction, index: number): RibbonItemNode {
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
        ["Parameters", action.parameters.map((parameter) => parameter.value).join(", ")],
      ],
    );
  }

  if (action.kind === "Url") {
    return new RibbonItemNode(`Url: ${action.address}`, undefined, "d365RibbonUrlAction", "link", [
      ["Index", index + 1],
      ["Address", action.address],
    ]);
  }

  return new RibbonItemNode("Unknown action", undefined, "d365RibbonUnknownAction", "warning", [
    ["Index", index + 1],
    ["Raw XML", action.raw],
  ]);
}

function ruleStepNode(step: RuleStep, index: number): RibbonItemNode {
  return new RibbonItemNode(
    `${index + 1}. ${step.kind}`,
    ruleStepDescription(step),
    `d365RibbonRuleStep:${step.kind}`,
    step.kind === "Unknown" ? "warning" : "symbol-property",
    ruleStepDetails(step, index),
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

function ruleStepDetails(
  step: RuleStep,
  index: number,
): Array<[string, string | number | undefined]> {
  const base: Array<[string, string | number | undefined]> = [
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
        ["Parameters", step.parameters.map((parameter) => parameter.value).join(", ")],
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

function locLabelTitleNode(title: LocLabelTitle): RibbonItemNode {
  return new RibbonItemNode(
    String(title.languageCode),
    title.description,
    "d365RibbonLocLabelTitle",
    "symbol-string",
    [
      ["Language", title.languageCode],
      ["Description", title.description],
    ],
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
  }
}

function compareDocuments(a: RibbonDocument, b: RibbonDocument): number {
  if (a.kind !== b.kind) {
    return a.kind === "Application" ? -1 : 1;
  }

  return documentLabel(a).localeCompare(documentLabel(b), undefined, { sensitivity: "base" });
}
