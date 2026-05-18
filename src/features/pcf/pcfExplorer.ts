import * as path from "path";
import * as vscode from "vscode";
import { PcfControlProject, PcfToolchainStatus } from "./models";
import { PacCli, detectTool } from "./pacCli";
import { PcfProjectLocator } from "./pcfProjectLocator";
import { ProcessRunner } from "./processRunner";

export type PcfExplorerNode =
  | PcfToolchainNode
  | PcfWorkspaceNode
  | PcfControlProjectNode
  | PcfProjectInfoNode
  | PcfNoWorkspaceNode;

export class PcfToolchainNode extends vscode.TreeItem {
  readonly contextValue = "d365PcfToolchain";

  constructor(readonly status: PcfToolchainStatus) {
    super("Toolchain", vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(status.pac.available ? "tools" : "warning");
    this.description = formatToolchain(status);
    this.tooltip = buildToolchainTooltip(status);
    this.command = {
      command: "dynamics365Tools.pcf.refreshExplorer",
      title: "Refresh PCF Explorer",
    };
  }
}

export class PcfWorkspaceNode extends vscode.TreeItem {
  readonly contextValue = "d365PcfWorkspace";

  constructor(readonly count: number) {
    super("Workspace", vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon("folder-library");
    this.description = count === 1 ? "1 control" : `${count} controls`;
  }
}

export class PcfControlProjectNode extends vscode.TreeItem {
  readonly contextValue = "d365PcfControlProject";

  constructor(readonly project: PcfControlProject) {
    super(project.fullName, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon("symbol-misc");
    this.description = `${project.controlType}, ${project.templateKind}`;
    this.tooltip = [
      project.fullName,
      `Version: ${project.version}`,
      `Root: ${project.rootUri}`,
      `Output: ${project.outputDir}`,
    ].join("\n");
    this.resourceUri = vscode.Uri.file(project.manifestUri);
    this.command = {
      command: "dynamics365Tools.pcf.openManifest",
      title: "Open Manifest",
      arguments: [this],
    };
  }
}

export class PcfProjectInfoNode extends vscode.TreeItem {
  readonly contextValue = "d365PcfProjectInfo";

  constructor(label: string, description?: string, icon = "info") {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export class PcfNoWorkspaceNode extends vscode.TreeItem {
  readonly contextValue = "d365PcfNoWorkspace";

  constructor() {
    super("No PCF controls found", vscode.TreeItemCollapsibleState.None);
    this.description = "Add a ControlManifest.Input.xml project";
    this.iconPath = new vscode.ThemeIcon("search");
  }
}

export class PcfExplorerProvider implements vscode.TreeDataProvider<PcfExplorerNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    PcfExplorerNode | undefined | void
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private toolchainStatus?: PcfToolchainStatus;

  constructor(
    private readonly locator: PcfProjectLocator,
    private readonly runner: ProcessRunner,
    private readonly pacCli: PacCli,
  ) {
    this.locator.onDidChangeProjects(() => this.refresh());
  }

  refresh(node?: PcfExplorerNode): void {
    if (!node) {
      this.toolchainStatus = undefined;
    }
    this.onDidChangeTreeDataEmitter.fire(node);
  }

  getTreeItem(element: PcfExplorerNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PcfExplorerNode): Promise<PcfExplorerNode[]> {
    if (!element) {
      return [
        new PcfToolchainNode(await this.getToolchainStatus()),
        new PcfWorkspaceNode(this.locator.getProjects().length),
      ];
    }

    if (element instanceof PcfWorkspaceNode) {
      const projects = this.locator.getProjects();
      return projects.length
        ? projects.map((project) => new PcfControlProjectNode(project))
        : [new PcfNoWorkspaceNode()];
    }

    if (element instanceof PcfControlProjectNode) {
      return [
        new PcfProjectInfoNode("Manifest", path.basename(element.project.manifestUri), "file-code"),
        new PcfProjectInfoNode(
          "Properties",
          `ns=${element.project.namespace}, version=${element.project.version}, template=${element.project.controlType}`,
          "symbol-property",
        ),
        new PcfProjectInfoNode(
          "Build status",
          element.project.hasNodeModules ? "ready" : "dependencies not installed",
          element.project.hasNodeModules ? "pass" : "circle-slash",
        ),
      ];
    }

    return [];
  }

  private async getToolchainStatus(): Promise<PcfToolchainStatus> {
    if (!this.toolchainStatus) {
      const [pac, node, npm, dotnet] = await Promise.all([
        this.pacCli.detect(),
        detectTool(this.runner, "node", ["--version"]),
        detectTool(this.runner, "npm", ["--version"]),
        detectTool(this.runner, "dotnet", ["--version"]),
      ]);
      this.toolchainStatus = { pac, node, npm, dotnet };
    }
    return this.toolchainStatus;
  }
}

function formatToolchain(status: PcfToolchainStatus): string {
  const parts = [
    formatTool("pac", status.pac),
    formatTool("node", status.node),
    formatTool("dotnet", status.dotnet),
  ];
  return parts.join(" · ");
}

function formatTool(name: string, result: { available: boolean; version?: string }): string {
  if (!result.available) {
    return `${name} missing`;
  }
  return result.version ? `${name} ${result.version}` : `${name} available`;
}

function buildToolchainTooltip(status: PcfToolchainStatus): string {
  return [
    `pac: ${formatToolStatus(status.pac)}`,
    `node: ${formatToolStatus(status.node)}`,
    `npm: ${formatToolStatus(status.npm)}`,
    `dotnet: ${formatToolStatus(status.dotnet)}`,
  ].join("\n");
}

function formatToolStatus(result: {
  available: boolean;
  version?: string;
  error?: string;
}): string {
  if (result.available) {
    return result.version ?? "available";
  }
  return result.error ?? "missing";
}
