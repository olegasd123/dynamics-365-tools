import * as vscode from "vscode";
import { ConfigurationService } from "../services/configurationService";
import { EnvironmentConnectionService } from "../services/environmentConnectionService";
import { DataverseClient } from "../services/dataverseClient";
import { SolutionComponentService } from "../services/solutionComponentService";
import { PluginService } from "./pluginService";
import { PluginAssembly, PluginImage, PluginStep, PluginType } from "./models";
import { EnvironmentConfig } from "../types";

export type PluginExplorerNode =
  | EnvironmentNode
  | PluginAssemblyNode
  | PluginTypeNode
  | PluginStepNode
  | PluginImageNode;

export class PluginExplorerProvider implements vscode.TreeDataProvider<PluginExplorerNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    PluginExplorerNode | undefined | void
  >();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly connections: EnvironmentConnectionService,
  ) {}

  refresh(node?: PluginExplorerNode): void {
    this.onDidChangeTreeDataEmitter.fire(node);
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
      return this.loadImages(element.env, element.step);
    }

    return [];
  }

  private async loadEnvironments(): Promise<PluginExplorerNode[]> {
    const config = await this.configuration.loadConfiguration();
    return config.environments.map((env) => new EnvironmentNode(env));
  }

  private async loadAssemblies(env: EnvironmentConfig): Promise<PluginExplorerNode[]> {
    const service = await this.getPluginService(env);
    if (!service) {
      return [];
    }

    try {
      const assemblies = await service.listAssemblies();
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
      return types.map((type) => new PluginTypeNode(env, type));
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
      return steps.map((step) => new PluginStepNode(env, step));
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to load steps for ${pluginType.name}: ${String(error)}`,
      );
      return [];
    }
  }

  private async loadImages(env: EnvironmentConfig, step: PluginStep): Promise<PluginExplorerNode[]> {
    const service = await this.getPluginService(env);
    if (!service) {
      return [];
    }

    try {
      const images = await service.listImages(step.id);
      return images.map((image) => new PluginImageNode(env, image));
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to load images for ${step.name}: ${String(error)}`,
      );
      return [];
    }
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
}

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
    this.description = assembly.version;
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
    super(pluginType.friendlyName || pluginType.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = pluginType.typeName;
    this.tooltip = buildTypeTooltip(pluginType);
    this.iconPath = new vscode.ThemeIcon("symbol-class");
  }
}

export class PluginStepNode extends vscode.TreeItem {
  readonly contextValue = "d365PluginStep";

  constructor(
    readonly env: EnvironmentConfig,
    readonly step: PluginStep,
  ) {
    super(step.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = buildStepDescription(step);
    this.tooltip = buildStepTooltip(step);
    this.iconPath = new vscode.ThemeIcon("run");
  }
}

export class PluginImageNode extends vscode.TreeItem {
  readonly contextValue = "d365PluginImage";

  constructor(
    readonly env: EnvironmentConfig,
    readonly image: PluginImage,
  ) {
    super(image.name, vscode.TreeItemCollapsibleState.None);
    this.description = buildImageDescription(image);
    this.tooltip = buildImageTooltip(image);
    this.iconPath = new vscode.ThemeIcon("file-media");
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

function buildStepDescription(step: PluginStep): string | undefined {
  const mode = formatStepMode(step.mode);
  const stage = formatStepStage(step.stage);
  const message = step.messageName;
  const segments = [message, stage, mode].filter(Boolean);
  return segments.join(" • ") || undefined;
}

function buildStepTooltip(step: PluginStep): vscode.MarkdownString {
  const lines = [
    `**Name:** ${step.name}`,
    step.messageName ? `**Message:** ${step.messageName}` : undefined,
    step.primaryEntity ? `**Primary entity:** ${step.primaryEntity}` : undefined,
    step.stage !== undefined ? `**Stage:** ${formatStepStage(step.stage)}` : undefined,
    step.mode !== undefined ? `**Mode:** ${formatStepMode(step.mode)}` : undefined,
    step.rank !== undefined ? `**Rank:** ${step.rank}` : undefined,
    step.filteringAttributes
      ? `**Filtering attributes:** ${step.filteringAttributes}`
      : undefined,
    step.status !== undefined ? `**Status:** ${formatStepStatus(step.status)}` : undefined,
  ].filter(Boolean);

  return new vscode.MarkdownString(lines.join("\n"));
}

function buildImageDescription(image: PluginImage): string | undefined {
  const type = formatImageType(image.type);
  const alias = image.entityAlias;
  const segments = [alias, type].filter(Boolean);
  return segments.join(" • ") || undefined;
}

function buildImageTooltip(image: PluginImage): vscode.MarkdownString {
  const parts = [
    `**Name:** ${image.name}`,
    image.entityAlias ? `**Alias:** ${image.entityAlias}` : undefined,
    image.type !== undefined ? `**Type:** ${formatImageType(image.type)}` : undefined,
    image.attributes ? `**Attributes:** ${image.attributes}` : undefined,
    image.messagePropertyName
      ? `**Message property:** ${image.messagePropertyName}`
      : undefined,
  ].filter(Boolean);
  return new vscode.MarkdownString(parts.join("\n"));
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
