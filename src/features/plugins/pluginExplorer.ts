import * as vscode from "vscode";
import { ConfigurationService } from "../config/configurationService";
import { EnvironmentConnectionService } from "../dataverse/environmentConnectionService";
import { DataverseClient, isDefaultSolution } from "../dataverse/dataverseClient";
import { SolutionComponentService } from "../dataverse/solutionComponentService";
import { PluginService } from "./pluginService";
import { PluginAssembly, PluginImage, PluginStep, PluginType } from "./models";
import { EnvironmentConfig, SolutionConfig } from "../config/domain/models";

const SOLUTION_FILTER_STATE_KEY = "d365Tools.plugins.filterConfiguredSolutions";
const SOLUTION_FILTER_CONTEXT_KEY = "d365Tools.plugins.filterConfiguredSolutions";

export type PluginExplorerNode =
  | EnvironmentNode
  | PluginAssemblyNode
  | PluginTypeNode
  | PluginStepNode
  | PluginImageNode
  | MissingConfigurationNode;

export class EnvironmentNode extends vscode.TreeItem {
  constructor(readonly env: EnvironmentConfig) {
    super(env.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "d365PluginEnvironment";
    this.description = env.url;
    this.iconPath = new vscode.ThemeIcon("globe");
  }
}

export class PluginAssemblyNode extends vscode.TreeItem {
  readonly contextValue = "d365PluginAssembly";

  constructor(
    readonly env: EnvironmentConfig,
    readonly assembly: PluginAssembly,
  ) {
    super(assembly.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `[${assembly.version}] ${formatDateTimeWithoutSeconds(assembly.modifiedOn)}`;
    this.tooltip = buildAssemblyTooltip(assembly);
    this.iconPath = new vscode.ThemeIcon("package");
  }
}

export class PluginTypeNode extends vscode.TreeItem {
  readonly contextValue = "d365PluginType";

  constructor(
    readonly env: EnvironmentConfig,
    readonly pluginType: PluginType,
  ) {
    super(pluginType.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.tooltip = buildTypeTooltip(pluginType);
    this.iconPath = new vscode.ThemeIcon("symbol-class");
  }
}

export class PluginStepNode extends vscode.TreeItem {
  contextValue: string;

  constructor(
    readonly env: EnvironmentConfig,
    readonly pluginType: PluginType,
    readonly step: PluginStep,
  ) {
    const pluginLabel = buildStepLabel(pluginType, step);
    super(pluginLabel, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = buildStepDescription(step);
    this.tooltip = buildStepTooltip(pluginType, step);
    this.iconPath = buildStepIcon(step);
    this.contextValue = buildStepContextValue(step);
  }
}

export class PluginImageNode extends vscode.TreeItem {
  readonly contextValue = "d365PluginImage";

  constructor(
    readonly env: EnvironmentConfig,
    readonly pluginType: PluginType,
    readonly step: PluginStep,
    readonly image: PluginImage,
  ) {
    const pluginLabel = image.name ?? pluginType.typeName ?? pluginType.name;
    super(pluginLabel, vscode.TreeItemCollapsibleState.None);
    this.description = buildImageDescription(image);
    this.tooltip = buildImageTooltip(pluginType, image);
    this.iconPath = new vscode.ThemeIcon("file-media");
  }
}

export class MissingConfigurationNode extends vscode.TreeItem {
  readonly contextValue = "d365PluginConfigMissing";

  constructor() {
    super("Create dynamics365tools.config.json", vscode.TreeItemCollapsibleState.None);
    this.description = "Open or create configuration";
    this.tooltip = "Create or open .vscode/dynamics365tools.config.json";
    this.iconPath = new vscode.ThemeIcon("gear");
    this.command = {
      command: "dynamics365Tools.configureEnvironments",
      title: "Open Dynamics 365 Tools configuration",
    };
  }
}

export class PluginExplorerProvider implements vscode.TreeDataProvider<PluginExplorerNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    PluginExplorerNode | undefined | void
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private filterByConfiguredSolutions = true;

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly connections: EnvironmentConnectionService,
    private readonly state: vscode.Memento,
  ) {}

  async initialize(): Promise<void> {
    this.filterByConfiguredSolutions = this.state.get<boolean>(SOLUTION_FILTER_STATE_KEY, true);
    await this.state.update(SOLUTION_FILTER_STATE_KEY, this.filterByConfiguredSolutions);
    this.updateFilterContext();
  }

  refresh(node?: PluginExplorerNode): void {
    this.onDidChangeTreeDataEmitter.fire(node);
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

  getTreeItem(element: PluginExplorerNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PluginExplorerNode): Promise<PluginExplorerNode[]> {
    if (!element) {
      return this.loadEnvironments();
    }

    if (element instanceof EnvironmentNode) {
      return this.loadAssemblies(element.env);
    }

    if (element instanceof PluginAssemblyNode) {
      return this.loadPluginTypes(element.env, element.assembly);
    }

    if (element instanceof PluginTypeNode) {
      return this.loadSteps(element.env, element.pluginType);
    }

    if (element instanceof PluginStepNode) {
      return this.loadImages(element.env, element.pluginType, element.step);
    }

    return [];
  }

  private async loadEnvironments(): Promise<PluginExplorerNode[]> {
    const config = await this.configuration.loadExistingConfiguration();
    if (!config) {
      return [new MissingConfigurationNode()];
    }
    return config.environments.map((env) => new EnvironmentNode(env));
  }

  private async loadAssemblies(env: EnvironmentConfig): Promise<PluginExplorerNode[]> {
    const service = await this.getPluginService(env);
    if (!service) {
      return [];
    }

    try {
      const config = await this.configuration.loadConfiguration();
      const solutionNames = this.getSolutionNamesForFiltering(config.solutions);
      const assemblies = await service.listAssemblies({ solutionNames });
      return assemblies.map((assembly) => new PluginAssemblyNode(env, assembly));
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to load plugin assemblies from ${env.name}: ${String(error)}`,
      );
      return [];
    }
  }

  private async loadPluginTypes(
    env: EnvironmentConfig,
    assembly: PluginAssembly,
  ): Promise<PluginExplorerNode[]> {
    const service = await this.getPluginService(env);
    if (!service) {
      return [];
    }

    try {
      const types = await service.listPluginTypes(assembly.id);
      return types
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
        .map((type) => new PluginTypeNode(env, type));
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to load plugin types for ${assembly.name}: ${String(error)}`,
      );
      return [];
    }
  }

  private async loadSteps(
    env: EnvironmentConfig,
    pluginType: PluginType,
  ): Promise<PluginExplorerNode[]> {
    const service = await this.getPluginService(env);
    if (!service) {
      return [];
    }

    try {
      const steps = await service.listSteps(pluginType.id);
      return steps
        .slice()
        .sort((a, b) =>
          buildStepLabel(pluginType, a).localeCompare(buildStepLabel(pluginType, b), undefined, {
            sensitivity: "base",
          }),
        )
        .map((step) => new PluginStepNode(env, pluginType, step));
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to load steps for ${pluginType.name}: ${String(error)}`,
      );
      return [];
    }
  }

  private async loadImages(
    env: EnvironmentConfig,
    pluginType: PluginType,
    step: PluginStep,
  ): Promise<PluginExplorerNode[]> {
    const service = await this.getPluginService(env);
    if (!service) {
      return [];
    }

    try {
      const images = await service.listImages(step.id);
      return images.map((image) => new PluginImageNode(env, pluginType, step, image));
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to load images for ${step.name}: ${String(error)}`,
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

  private async getPluginService(env: EnvironmentConfig): Promise<PluginService | undefined> {
    try {
      const connection = await this.connections.createConnection(env);
      if (!connection) {
        return undefined;
      }
      const client = new DataverseClient(connection);
      const solutionComponents = new SolutionComponentService(client);
      return new PluginService(client, solutionComponents);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Authentication failed for ${env.name}: ${String(error)}`,
      );
      return undefined;
    }
  }

  private updateFilterContext(): void {
    void vscode.commands.executeCommand(
      "setContext",
      SOLUTION_FILTER_CONTEXT_KEY,
      this.filterByConfiguredSolutions,
    );
  }
}

function buildAssemblyTooltip(assembly: PluginAssembly): vscode.MarkdownString {
  const parts = [
    `**Name:** ${assembly.name}`,
    assembly.version ? `**Version:** ${assembly.version}` : undefined,
    assembly.publicKeyToken ? `**Public key token:** ${assembly.publicKeyToken}` : undefined,
    assembly.culture ? `**Culture:** ${assembly.culture}` : undefined,
    assembly.isolationMode !== undefined
      ? `**Isolation:** ${formatIsolationMode(assembly.isolationMode)}`
      : undefined,
  ].filter(Boolean);
  return new vscode.MarkdownString(parts.join("\n"));
}

function buildTypeTooltip(pluginType: PluginType): vscode.MarkdownString {
  const parts = [
    `**Name:** ${pluginType.name}`,
    pluginType.friendlyName ? `**Friendly name:** ${pluginType.friendlyName}` : undefined,
    pluginType.typeName ? `**Type:** ${pluginType.typeName}` : undefined,
  ].filter(Boolean);
  return new vscode.MarkdownString(parts.join("\n"));
}

function buildStepLabel(pluginType: PluginType, step: PluginStep): string {
  const base = step.messageName || pluginType.typeName || pluginType.name;
  const entityPart = step.primaryEntity ? ` of ${step.primaryEntity}` : "";
  const stage = step.stage !== undefined ? formatStepStage(step.stage) : undefined;
  const stagePart = stage ? ` [${stage}]` : "";
  return `${base}${entityPart}${stagePart}`;
}

function buildStepDescription(step: PluginStep): string | undefined {
  const segments =
    step.filteringAttributes
      ?.split(",")
      .map((attr) => attr.trim())
      .filter(Boolean) || [];
  return segments.join(" • ") || undefined;
}

function buildStepTooltip(pluginType: PluginType, step: PluginStep): vscode.MarkdownString {
  const lines = [
    `**Plugin:** ${pluginType.typeName ?? pluginType.name}`,
    step.name ? `**Step name:** ${step.name}` : undefined,
    step.messageName ? `**Message:** ${step.messageName}` : undefined,
    step.primaryEntity ? `**Primary entity:** ${step.primaryEntity}` : undefined,
    step.stage !== undefined ? `**Stage:** ${formatStepStage(step.stage)}` : undefined,
    step.mode !== undefined ? `**Mode:** ${formatStepMode(step.mode)}` : undefined,
    step.rank !== undefined ? `**Rank:** ${step.rank}` : undefined,
    step.filteringAttributes ? `**Filtering attributes:** ${step.filteringAttributes}` : undefined,
    step.status !== undefined ? `**Status:** ${formatStepStatus(step.status)}` : undefined,
  ].filter(Boolean);

  return new vscode.MarkdownString(lines.join("\n"));
}

function buildStepIcon(step: PluginStep): vscode.ThemeIcon {
  if (step.status === 1) {
    return new vscode.ThemeIcon("debug-pause");
  }
  if (step.status === 0) {
    return new vscode.ThemeIcon("debug-start");
  }
  return new vscode.ThemeIcon("run");
}

function buildStepContextValue(step: PluginStep): string {
  if (step.status === 1) {
    return "d365PluginStep:disabled";
  }
  if (step.status === 0) {
    return "d365PluginStep:enabled";
  }
  return "d365PluginStep";
}

function buildImageDescription(image: PluginImage): string | undefined {
  const segments =
    image.attributes
      ?.slice()
      .split(",")
      .map((attr) => attr.trim()) || [];
  return segments.join(" • ") || undefined;
}

function buildImageTooltip(pluginType: PluginType, image: PluginImage): vscode.MarkdownString {
  const parts = [
    `**Plugin:** ${pluginType.typeName ?? pluginType.name}`,
    image.name ? `**Image name:** ${image.name}` : undefined,
    image.entityAlias ? `**Alias:** ${image.entityAlias}` : undefined,
    image.type !== undefined ? `**Type:** ${formatImageType(image.type)}` : undefined,
    image.attributes ? `**Attributes:** ${image.attributes}` : undefined,
    image.messagePropertyName ? `**Message property:** ${image.messagePropertyName}` : undefined,
  ].filter(Boolean);
  return new vscode.MarkdownString(parts.join("\n"));
}

function formatDateTimeWithoutSeconds(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatIsolationMode(value?: number): string {
  switch (value) {
    case 1:
      return "None";
    case 2:
      return "Sandbox";
    default:
      return "Unknown";
  }
}

function formatStepStage(value?: number): string {
  switch (value) {
    case 10:
      return "Pre-validation";
    case 20:
      return "Pre-operation";
    case 40:
      return "Post-operation";
    default:
      return "Unknown stage";
  }
}

function formatStepMode(value?: number): string {
  switch (value) {
    case 0:
      return "Synchronous";
    case 1:
      return "Asynchronous";
    default:
      return "Unknown mode";
  }
}

function formatStepStatus(value?: number): string {
  switch (value) {
    case 0:
      return "Enabled";
    case 1:
      return "Disabled";
    default:
      return "Unknown";
  }
}

function formatImageType(value?: number): string {
  switch (value) {
    case 0:
      return "Pre-image";
    case 1:
      return "Post-image";
    case 2:
      return "Both";
    default:
      return "Unknown";
  }
}
