import * as path from "path";
import * as vscode from "vscode";
import { ConfigurationService } from "../config/configurationService";
import { EnvironmentConfig, SolutionConfig } from "../config/domain/models";
import { isDefaultSolution } from "../dataverse/dataverseClient";
import {
  PcfBuildStatus,
  DeployedPcfControl,
  PcfControlProject,
  PcfToolchainStatus,
} from "./models";
import { PacCli, detectTool } from "./pacCli";
import { PcfBuildService } from "./pcfBuildService";
import { PcfEnvironmentService } from "./pcfEnvironmentService";
import { PcfProjectLocator } from "./pcfProjectLocator";
import { ProcessRunner } from "./processRunner";

const SOLUTION_FILTER_STATE_KEY = "d365Tools.pcf.filterConfiguredSolutions";
const SOLUTION_FILTER_CONTEXT_KEY = "d365Tools.pcf.filterConfiguredSolutions";
const WORKSPACE_FOLDER_FILTER_STATE_KEY = "d365Tools.pcf.workspaceFolderFilterRoot";

export type PcfExplorerNode =
  | PcfToolchainNode
  | PcfWorkspaceNode
  | PcfControlProjectNode
  | PcfProjectInfoNode
  | PcfNoWorkspaceNode
  | PcfEnvironmentNode
  | PcfDeployedControlNode
  | PcfNoDeployedControlsNode
  | PcfMissingConfigurationNode;

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

  constructor(
    readonly count: number,
    filterLabel?: string,
  ) {
    super("Workspace", vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon("folder-library");
    const countLabel = count === 1 ? "1 control" : `${count} controls`;
    this.description = filterLabel ? `${countLabel} · ${filterLabel}` : countLabel;
  }
}

export class PcfControlProjectNode extends vscode.TreeItem {
  readonly contextValue: string;

  constructor(
    readonly project: PcfControlProject,
    isWatching = false,
  ) {
    super(project.fullName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = `d365PcfControlProject:${isWatching ? "watching" : "stopped"}`;
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

export class PcfEnvironmentNode extends vscode.TreeItem {
  readonly contextValue = "d365PcfEnvironment";

  constructor(
    readonly env: EnvironmentConfig,
    readonly filterByConfiguredSolutions: boolean,
  ) {
    super(`Environment: ${env.name}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon("cloud");
    this.description = filterByConfiguredSolutions ? "filtered" : env.url;
    this.tooltip = [
      env.url,
      filterByConfiguredSolutions
        ? "Filtered to configured solutions unless Default is configured."
        : "Showing all deployed controls.",
    ].join("\n");
  }
}

export class PcfDeployedControlNode extends vscode.TreeItem {
  readonly contextValue: string;

  constructor(
    readonly env: EnvironmentConfig,
    readonly control: DeployedPcfControl,
  ) {
    super(control.name, vscode.TreeItemCollapsibleState.None);
    const drift = getVersionDrift(control);
    this.description = [control.version ? `v${control.version}` : undefined, drift?.label]
      .filter(Boolean)
      .join(" · ");
    this.tooltip = buildDeployedControlTooltip(control);
    this.iconPath = new vscode.ThemeIcon(control.workspaceMatch ? "link" : "cloud");
    this.contextValue = control.workspaceMatch
      ? `d365PcfDeployedControl:matched:${drift?.key ?? "matched"}`
      : "d365PcfDeployedControl";
  }
}

export class PcfNoDeployedControlsNode extends vscode.TreeItem {
  readonly contextValue = "d365PcfNoDeployedControls";

  constructor() {
    super("No deployed PCF controls found", vscode.TreeItemCollapsibleState.None);
    this.description = "Refresh or change the solution filter";
    this.iconPath = new vscode.ThemeIcon("search");
  }
}

export class PcfMissingConfigurationNode extends vscode.TreeItem {
  readonly contextValue = "d365PcfConfigMissing";

  constructor() {
    super("Add an environment to see deployed PCF controls", vscode.TreeItemCollapsibleState.None);
    this.description = "Configure environments";
    this.iconPath = new vscode.ThemeIcon("add");
    this.command = {
      command: "dynamics365Tools.configureEnvironments",
      title: "Configure Environments",
    };
  }
}

export class PcfExplorerProvider implements vscode.TreeDataProvider<PcfExplorerNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    PcfExplorerNode | undefined | void
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private toolchainStatus?: PcfToolchainStatus;
  private filterByConfiguredSolutions = true;
  private workspaceFolderFilterRoot?: string;

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly state: vscode.Memento,
    private readonly locator: PcfProjectLocator,
    private readonly runner: ProcessRunner,
    private readonly pacCli: PacCli,
    private readonly buildService: PcfBuildService,
    private readonly environmentService: PcfEnvironmentService,
  ) {
    this.locator.onDidChangeProjects(() => this.refresh());
    this.buildService.onDidChangeStatus(() => this.refresh());
  }

  async initialize(): Promise<void> {
    this.filterByConfiguredSolutions = this.state.get<boolean>(SOLUTION_FILTER_STATE_KEY, true);
    this.workspaceFolderFilterRoot = this.state.get<string | undefined>(
      WORKSPACE_FOLDER_FILTER_STATE_KEY,
      undefined,
    );
    await this.state.update(SOLUTION_FILTER_STATE_KEY, this.filterByConfiguredSolutions);
    this.updateFilterContext();
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
      const projects = this.getVisibleProjects();
      const roots: PcfExplorerNode[] = [
        new PcfToolchainNode(await this.getToolchainStatus()),
        new PcfWorkspaceNode(projects.length, this.getWorkspaceFolderFilterLabel()),
      ];
      roots.push(...(await this.loadEnvironmentRoots()));
      return roots;
    }

    if (element instanceof PcfWorkspaceNode) {
      const projects = this.getVisibleProjects();
      return projects.length
        ? projects.map(
            (project) => new PcfControlProjectNode(project, this.buildService.isWatching(project)),
          )
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
          this.formatBuildStatus(element.project),
          this.getBuildStatusIcon(element.project),
        ),
        new PcfProjectInfoNode(
          "Watch",
          this.buildService.isWatching(element.project) ? "running" : "stopped",
          this.buildService.isWatching(element.project) ? "sync" : "debug-stop",
        ),
      ];
    }

    if (element instanceof PcfEnvironmentNode) {
      return this.loadDeployedControls(element.env);
    }

    return [];
  }

  async toggleSolutionFilter(): Promise<void> {
    await this.setSolutionFilter(!this.filterByConfiguredSolutions);
  }

  async setSolutionFilter(enabled: boolean): Promise<void> {
    if (this.filterByConfiguredSolutions === enabled) {
      return;
    }

    this.filterByConfiguredSolutions = enabled;
    await this.state.update(SOLUTION_FILTER_STATE_KEY, this.filterByConfiguredSolutions);
    this.updateFilterContext();
    this.refresh();
  }

  async setWorkspaceFolderFilter(rootUri: string | undefined): Promise<void> {
    this.workspaceFolderFilterRoot = rootUri;
    await this.state.update(WORKSPACE_FOLDER_FILTER_STATE_KEY, rootUri);
    this.refresh();
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

  private formatBuildStatus(project: PcfControlProject): string {
    const status = this.buildService.getBuildStatus(project);
    if (status.kind === "never") {
      return project.hasNodeModules ? "never built" : "dependencies not installed";
    }
    return formatBuildStatus(status);
  }

  private getBuildStatusIcon(project: PcfControlProject): string {
    const status = this.buildService.getBuildStatus(project);
    if (status.kind === "success") {
      return "pass";
    }
    if (status.kind === "failed") {
      return "error";
    }
    if (status.kind === "running") {
      return "sync";
    }
    return project.hasNodeModules ? "circle-large-outline" : "circle-slash";
  }

  private async loadEnvironmentRoots(): Promise<PcfExplorerNode[]> {
    const config = await this.configuration.loadExistingConfiguration();
    if (!config) {
      return [new PcfMissingConfigurationNode()];
    }
    if (!config.environments.length) {
      return [new PcfMissingConfigurationNode()];
    }

    return config.environments.map(
      (env) => new PcfEnvironmentNode(env, this.filterByConfiguredSolutions),
    );
  }

  private async loadDeployedControls(env: EnvironmentConfig): Promise<PcfExplorerNode[]> {
    try {
      const config = await this.configuration.loadConfiguration();
      const solutionNames = this.getSolutionNamesForFiltering(config.solutions);
      const controls = await this.environmentService.listControls(env, {
        solutionNames,
        workspaceProjects: this.getVisibleProjects(),
      });
      if (!controls?.length) {
        return [new PcfNoDeployedControlsNode()];
      }
      return controls.map((control) => new PcfDeployedControlNode(env, control));
    } catch (error) {
      const message = String(error);
      void vscode.window.showErrorMessage(
        isUserNotMemberError(message)
          ? `Failed to load PCF controls from ${env.name}: account has no access. Run 'Dynamics 365 Tools: Sign In (Interactive)' and select the correct account for this environment.`
          : `Failed to load PCF controls from ${env.name}: ${message}`,
      );
      return [];
    }
  }

  private getSolutionNamesForFiltering(solutions: SolutionConfig[]): string[] | undefined {
    if (!this.filterByConfiguredSolutions) {
      return undefined;
    }

    if (solutions.some((solution) => isDefaultSolution(solution.name))) {
      return undefined;
    }

    const names = solutions
      .map((solution) => solution.name?.trim())
      .filter((name): name is string => Boolean(name))
      .filter((name) => !isDefaultSolution(name));

    return names.length ? names : undefined;
  }

  private updateFilterContext(): void {
    void vscode.commands.executeCommand(
      "setContext",
      SOLUTION_FILTER_CONTEXT_KEY,
      this.filterByConfiguredSolutions,
    );
  }

  private getVisibleProjects(): PcfControlProject[] {
    const projects = this.locator.getProjects();
    const root = this.workspaceFolderFilterRoot;
    if (!root) {
      return projects;
    }

    return projects.filter((project) => isInsideFolder(project.rootUri, root));
  }

  private getWorkspaceFolderFilterLabel(): string | undefined {
    const root = this.workspaceFolderFilterRoot;
    if (!root) {
      return undefined;
    }

    const folder = vscode.workspace.workspaceFolders?.find((item) =>
      samePath(item.uri.fsPath, root),
    );
    return folder?.name ?? path.basename(root);
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

function formatBuildStatus(status: PcfBuildStatus): string {
  if (status.kind === "running") {
    return "building";
  }
  if (status.kind === "success") {
    return status.durationMs ? `built in ${status.durationMs}ms` : "built";
  }
  if (status.kind === "failed") {
    return status.exitCode === undefined ? "failed" : `failed (${status.exitCode})`;
  }
  return "never built";
}

function buildDeployedControlTooltip(control: DeployedPcfControl): string {
  return [
    control.name,
    control.version ? `Version: ${control.version}` : undefined,
    `Managed: ${control.managed ? "yes" : "no"}`,
    `ID: ${control.customControlId}`,
    control.workspaceMatch
      ? `Matches workspace project: ${control.workspaceMatch.rootUri}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function getVersionDrift(control: DeployedPcfControl): { key: string; label: string } | undefined {
  const project = control.workspaceMatch;
  if (!project || !control.version) {
    return project ? { key: "matched", label: "matches workspace" } : undefined;
  }

  const comparison = compareVersions(project.version, control.version);
  if (comparison === 0) {
    return { key: "inSync", label: "in sync" };
  }
  return comparison > 0
    ? { key: "workspaceNewer", label: "workspace newer" }
    : { key: "environmentNewer", label: "environment newer" };
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function parseVersion(value: string): number[] {
  const match = value.match(/\d+(?:\.\d+)*/);
  if (!match) {
    return [];
  }
  return match[0].split(".").map((part) => Number.parseInt(part, 10));
}

function isUserNotMemberError(message: string): boolean {
  return (
    message.includes("0x80072560") ||
    message.toLowerCase().includes("user is not a member of the organization")
  );
}

function isInsideFolder(filePath: string, folderPath: string): boolean {
  const relative = path.relative(folderPath, filePath);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}
