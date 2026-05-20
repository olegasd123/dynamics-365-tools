import * as vscode from "vscode";
import { ConfigurationService } from "../config/configurationService";
import {
  CommandDefinition,
  CustomAction,
  DisplayRule,
  EnableRule,
  HideAction,
  LocLabel,
  RibbonDocument,
  RibbonSource,
  RibbonView,
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
    this.command = {
      command: "dynamics365Tools.ribbons.openFile",
      title: "Open Ribbon XML",
      arguments: [this],
    };
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

  constructor(label: string, description: string | undefined, contextValue: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
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
  );
}

function hideActionNode(action: HideAction): RibbonItemNode {
  return new RibbonItemNode(
    action.hideActionId,
    action.location ? `@ ${action.location}` : undefined,
    "d365RibbonHideAction",
    "eye-closed",
  );
}

function commandDefinitionNode(command: CommandDefinition): RibbonItemNode {
  return new RibbonItemNode(
    command.id,
    `${command.actions.length} actions`,
    "d365RibbonCommandDefinition",
    "gear",
  );
}

function enableRuleNode(rule: EnableRule): RibbonItemNode {
  return new RibbonItemNode(rule.id, `${rule.steps.length} steps`, "d365RibbonEnableRule", "check");
}

function displayRuleNode(rule: DisplayRule): RibbonItemNode {
  return new RibbonItemNode(rule.id, `${rule.steps.length} steps`, "d365RibbonDisplayRule", "eye");
}

function locLabelNode(label: LocLabel): RibbonItemNode {
  return new RibbonItemNode(
    label.id,
    `${label.titles.length} languages`,
    "d365RibbonLocLabel",
    "symbol-string",
  );
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
