import * as path from "path";
import * as vscode from "vscode";
import { promisify } from "util";
import { execFile } from "child_process";
import * as fs from "fs/promises";
import { pickEnvironmentAndAuth } from "../../../platform/vscode/commandUtils";
import { CommandContext } from "../../../app/commandContext";
import {
  EnvironmentAuthContext,
  EnvironmentConnectionService,
} from "../../dataverse/environmentConnectionService";
import { DataverseClient } from "../../dataverse/dataverseClient";
import { SolutionComponentService } from "../../dataverse/solutionComponentService";
import { PluginAssembly } from "../models";
import { PluginService } from "../pluginService";
import { PluginAssemblyNode, PluginExplorerProvider } from "../pluginExplorer";
import { PluginRegistrationManager, PluginSyncResult } from "../pluginRegistrationManager";
import { AssemblyIdentity, PluginAssemblyInspection } from "../pluginAssemblyIntrospector";
import { AssemblyStatusBarService } from "../../../platform/vscode/statusBar";
import { LastSelectionService } from "../../../platform/vscode/lastSelectionStore";
import { EnvironmentConfig } from "../../config/domain/models";

const execFileAsync = promisify(execFile);

export async function registerPluginAssembly(ctx: CommandContext): Promise<void> {
  const {
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    pluginRegistration,
    pluginExplorer,
    assemblyStatusBar,
  } = ctx;
  const config = await configuration.loadConfiguration();
  const selection = await pickEnvironmentAndAuth(
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    config,
    undefined,
    { placeHolder: "Select environment to register plugin assembly" },
  );
  if (!selection) {
    return;
  }

  if (selection.env.manageMissingComponents !== true) {
    void vscode.window.showWarningMessage(
      `Environment ${selection.env.name} is configured to block missing component management. Enable manageMissingComponents to register plugin assemblies.`,
    );
    return;
  }

  const assemblyFile = await vscode.window.showOpenDialog({
    canSelectFolders: false,
    canSelectMany: false,
    filters: { Assemblies: ["dll"] },
    title: "Select plugin assembly (.dll)",
  });
  if (!assemblyFile || !assemblyFile[0]) {
    return;
  }

  const defaultName = path.basename(assemblyFile[0].fsPath, path.extname(assemblyFile[0].fsPath));
  const name = await vscode.window.showInputBox({
    prompt: "Enter plugin assembly name",
    value: defaultName,
    ignoreFocusOut: true,
  });
  if (!name) {
    return;
  }

  const solution = await ui.promptSolution(config.solutions);
  if (!solution) {
    return;
  }

  const assemblyPath = assemblyFile[0].fsPath;
  const content = await vscode.workspace.fs.readFile(assemblyFile[0]);
  const contentBase64 = Buffer.from(content).toString("base64");

  try {
    const service = await createPluginService(connections, selection.auth, selection.env);
    const assemblyId = await service.registerAssembly({
      name,
      contentBase64,
      solutionName: solution.name,
    });

    let pluginSummary: string | undefined;
    let pluginSyncFailed = false;
    try {
      const syncResult = await syncPluginsForAssembly({
        registration: pluginRegistration,
        pluginService: service,
        assemblyId,
        assemblyPath,
        solutionName: solution.name,
        manageMissingComponents: true,
      });
      pluginSummary = syncResult;
    } catch (syncError) {
      void vscode.window.showErrorMessage(
        `Assembly registered, but plugins failed to sync: ${String(syncError)}`,
      );
      pluginSyncFailed = true;
    }

    await lastSelection.setLastAssemblyDllPath(selection.env.name, assemblyId, assemblyPath);
    assemblyStatusBar.setLastPublish({
      assemblyId,
      assemblyName: name,
      assemblyUri: vscode.Uri.file(assemblyPath),
      environment: selection.env,
    });
    if (!pluginSyncFailed) {
      vscode.window.showInformationMessage(
        buildAssemblySuccessMessage(name, selection.env.name, pluginSummary),
      );
    }
    pluginExplorer?.refresh();
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to register plugin assembly: ${String(error)}`);
  }
}

export async function updatePluginAssembly(
  ctx: CommandContext,
  targetNode?: PluginAssemblyNode,
): Promise<void> {
  const {
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    pluginRegistration,
    pluginExplorer,
    assemblyStatusBar,
  } = ctx;
  const config = await configuration.loadConfiguration();

  const selection = targetNode
    ? await pickEnvironmentAndAuth(
        configuration,
        ui,
        secrets,
        auth,
        lastSelection,
        config,
        targetNode.env.name,
        { placeHolder: "Select environment to update plugin assembly" },
      )
    : await pickEnvironmentAndAuth(
        configuration,
        ui,
        secrets,
        auth,
        lastSelection,
        config,
        undefined,
        { placeHolder: "Select environment to update plugin assembly" },
      );

  if (!selection) {
    return;
  }

  const env = selection.env;
  let service: PluginService;
  try {
    service = await createPluginService(connections, selection.auth, env);
  } catch (error) {
    void vscode.window.showErrorMessage(String(error));
    return;
  }

  let assemblyId: string | undefined;
  let assemblyName: string | undefined;

  if (targetNode) {
    assemblyId = targetNode.assembly.id;
    assemblyName = targetNode.assembly.name;
  } else {
    const assemblies = await service.listAssemblies();
    if (!assemblies.length) {
      vscode.window.showInformationMessage(`No plugin assemblies found in ${env.name}.`);
      return;
    }

    const pick = await vscode.window.showQuickPick(
      assemblies.map((assembly) => ({
        label: assembly.name,
        description: assembly.version,
        assembly,
      })),
      { placeHolder: "Select plugin assembly to update" },
    );
    if (!pick) {
      return;
    }
    assemblyId = pick.assembly.id;
    assemblyName = pick.assembly.name;
  }

  if (!assemblyId) {
    vscode.window.showErrorMessage("No plugin assembly selected for update.");
    return;
  }

  const lastDllPath = lastSelection.getLastAssemblyDllPath(env.name, assemblyId);
  const workspaceRoot =
    configuration.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const defaultUri = lastDllPath
    ? vscode.Uri.file(lastDllPath)
    : workspaceRoot
      ? vscode.Uri.file(workspaceRoot)
      : undefined;

  const assemblyFile = await vscode.window.showOpenDialog({
    canSelectFolders: false,
    canSelectMany: false,
    filters: { Assemblies: ["dll"] },
    defaultUri,
    title: "Select updated plugin assembly (.dll)",
  });
  if (!assemblyFile || !assemblyFile[0]) {
    return;
  }

  const assemblyUri = assemblyFile[0];
  const manageMissingComponents = env.manageMissingComponents === true;

  try {
    await updateAssemblyFromUri({
      assemblyId,
      assemblyName,
      assemblyUri,
      env,
      manageMissingComponents,
      pluginService: service,
      pluginRegistration,
      pluginExplorer,
      assemblyStatusBar,
      lastSelection,
    });
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to update plugin assembly: ${String(error)}`);
  }
}

export async function publishLastPluginAssembly(ctx: CommandContext): Promise<void> {
  const {
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    pluginRegistration,
    pluginExplorer,
    assemblyStatusBar,
  } = ctx;

  const last = assemblyStatusBar.getLastPublish();
  if (!last) {
    vscode.window.showInformationMessage(
      "Publish a plugin assembly first to enable quick publish.",
    );
    return;
  }

  try {
    await vscode.workspace.fs.stat(last.assemblyUri);
  } catch {
    vscode.window.showWarningMessage("Last published plugin assembly no longer exists.");
    assemblyStatusBar.clear();
    return;
  }

  const config = await configuration.loadConfiguration();
  const selection = await pickEnvironmentAndAuth(
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    config,
    last.environment.name,
    { placeHolder: "Select environment to publish plugin assembly" },
  );
  if (!selection) {
    return;
  }

  const confirmed = await confirmAssemblyPublish(
    last.assemblyUri,
    selection.env,
    last.assemblyName,
  );
  if (!confirmed) {
    return;
  }

  let service: PluginService;
  try {
    service = await createPluginService(connections, selection.auth, selection.env);
  } catch (error) {
    void vscode.window.showErrorMessage(String(error));
    return;
  }

  try {
    await updateAssemblyFromUri({
      assemblyId: last.assemblyId,
      assemblyName: last.assemblyName,
      assemblyUri: last.assemblyUri,
      env: selection.env,
      manageMissingComponents: selection.env.manageMissingComponents === true,
      pluginService: service,
      pluginRegistration,
      pluginExplorer,
      assemblyStatusBar,
      lastSelection,
    });
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to publish plugin assembly: ${String(error)}`);
  }
}

export async function generatePublicKeyToken(ctx: CommandContext): Promise<void> {
  const { configuration } = ctx;
  const workspaceRoot =
    configuration.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const projectPick = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri: workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined,
    filters: { "C# Project": ["csproj"], "All Files": ["*"] },
    openLabel: "Select .csproj to strong-name",
  });
  if (!projectPick || !projectPick[0]) {
    return;
  }

  const csprojUri = projectPick[0];
  const projectDir = path.dirname(csprojUri.fsPath);

  const filename = await vscode.window.showInputBox({
    prompt: "Enter file name for the strong name key (.snk)",
    value: "plugin.snk",
    ignoreFocusOut: true,
  });
  if (!filename) {
    return;
  }

  const resolvedPath = path.join(projectDir, filename);
  const relativeKeyPath = path.relative(projectDir, resolvedPath).replace(/\\/g, "/");

  const snTool = await resolveSnTool();
  if (!snTool) {
    void vscode.window.showErrorMessage(
      "Strong Name tool (sn.exe/sn) not found. Install the .NET SDK and ensure the `sn` tool is on your PATH.",
    );
    return;
  }

  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(resolvedPath)));
    await execFileAsync(snTool.command, [...snTool.generateArgs, resolvedPath]);
    const token = await generatePublicKeyTokenValue(snTool, resolvedPath);
    await ensureCsprojStrongName(csprojUri, relativeKeyPath);

    const message = token
      ? `Strong name key created and project updated. Public key token: ${token}`
      : "Strong name key created and project updated. Failed to read public key token from sn output.";
    showPublicKeyTokenResult(message, token);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to generate strong name key: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function showPublicKeyTokenResult(message: string, token?: string): void {
  const copyAction = token ? "Copy token" : undefined;
  void vscode.window.showInformationMessage(message, copyAction ?? "OK").then(
    async (selection) => {
      if (selection === copyAction && token) {
        try {
          await vscode.env.clipboard.writeText(token);
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Failed to copy public key token: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    },
    () => undefined,
  );
}

export function extractToken(output?: string): string | undefined {
  if (!output) {
    return undefined;
  }
  const match =
    output.match(/Public key token is\s+([0-9a-fA-F]+)/i) ||
    output.match(/Public key token=(\w+)/i) ||
    output.match(/Public key token:\s*([0-9a-fA-F]+)/i);
  return match?.[1];
}

async function generatePublicKeyTokenValue(
  snTool: SnTool,
  keyPath: string,
): Promise<string | undefined> {
  const publicKeyPath = path.join(
    path.dirname(keyPath),
    `.tmp-${path.basename(keyPath)}.public.snk`,
  );

  try {
    await execFileAsync(snTool.command, [...snTool.publicArgs, keyPath, publicKeyPath]);
    const tokenOutput = await execFileAsync(snTool.command, [...snTool.tokenArgs, publicKeyPath]);
    return extractToken(tokenOutput.stdout) || extractToken(tokenOutput.stderr);
  } catch (error) {
    const stderr = (error as any)?.stderr || (error as any)?.message;
    throw new Error(`sn failed to produce public key token: ${stderr ?? error}`);
  } finally {
    try {
      await fs.unlink(publicKeyPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

async function ensureCsprojStrongName(
  csprojUri: vscode.Uri,
  keyFileRelative: string,
): Promise<void> {
  const content = (await vscode.workspace.fs.readFile(csprojUri)).toString();
  if (content.includes("<AssemblyOriginatorKeyFile")) {
    return;
  }

  const insertion = [
    "  <PropertyGroup>",
    "    <SignAssembly>true</SignAssembly>",
    `    <AssemblyOriginatorKeyFile>${keyFileRelative}</AssemblyOriginatorKeyFile>`,
    "  </PropertyGroup>",
    "  <ItemGroup>",
    `    <None Include="${keyFileRelative}" />`,
    "  </ItemGroup>",
  ].join("\n");

  const closingTag = "</Project>";
  const index = content.lastIndexOf(closingTag);
  const updated =
    index >= 0
      ? `${content.slice(0, index)}${insertion}\n${closingTag}\n`
      : `${content.trimEnd()}\n${insertion}\n${closingTag}\n`;

  await vscode.workspace.fs.writeFile(csprojUri, Buffer.from(updated, "utf8"));
}

type PluginSyncContext = {
  registration: PluginRegistrationManager;
  pluginService: PluginService;
  assemblyId: string;
  assemblyPath: string;
  solutionName?: string;
  manageMissingComponents?: boolean;
};

function buildAssemblySuccessMessage(
  assemblyName: string | undefined,
  envName: string,
  pluginSummary?: string,
  action: "registered" | "updated" = "registered",
): string {
  const normalizedName = assemblyName ?? "assembly";
  const base = `Plugin assembly ${normalizedName} has been ${action} in ${envName}.`;
  return pluginSummary ? `${base} ${pluginSummary}` : base;
}

async function syncPluginsForAssembly(context: PluginSyncContext): Promise<string | undefined> {
  const title = `Syncing plugins for ${path.basename(context.assemblyPath)}`;
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
    },
    () =>
      context.registration.syncPluginTypes({
        pluginService: context.pluginService,
        assemblyId: context.assemblyId,
        assemblyPath: context.assemblyPath,
        solutionName: context.solutionName,
        manageMissingComponents: context.manageMissingComponents,
      }),
  );

  return formatPluginSyncResult(result);
}

type AssemblyUpdateContext = {
  assemblyId: string;
  assemblyName?: string;
  assemblyUri: vscode.Uri;
  env: EnvironmentConfig;
  manageMissingComponents: boolean;
  pluginService: PluginService;
  pluginRegistration: PluginRegistrationManager;
  pluginExplorer?: PluginExplorerProvider;
  assemblyStatusBar: AssemblyStatusBarService;
  lastSelection: LastSelectionService;
};

type AssemblyUpdateValidationContext = {
  assemblyId: string;
  assemblyUri: vscode.Uri;
  pluginService: Pick<PluginService, "getAssembly" | "listPluginTypes">;
  pluginRegistration: Pick<PluginRegistrationManager, "inspectAssembly">;
};

async function updateAssemblyFromUri(context: AssemblyUpdateContext): Promise<void> {
  const canUpdate = await validateAssemblyUpdateTarget({
    assemblyId: context.assemblyId,
    assemblyUri: context.assemblyUri,
    pluginService: context.pluginService,
    pluginRegistration: context.pluginRegistration,
  });
  if (!canUpdate) {
    return;
  }

  const content = await vscode.workspace.fs.readFile(context.assemblyUri);
  const contentBase64 = Buffer.from(content).toString("base64");

  await context.pluginService.updateAssembly(context.assemblyId, contentBase64);
  await context.lastSelection.setLastAssemblyDllPath(
    context.env.name,
    context.assemblyId,
    context.assemblyUri.fsPath,
  );

  let pluginSummary: string | undefined;
  try {
    pluginSummary = await syncPluginsForAssembly({
      registration: context.pluginRegistration,
      pluginService: context.pluginService,
      assemblyId: context.assemblyId,
      assemblyPath: context.assemblyUri.fsPath,
      solutionName: undefined,
      manageMissingComponents: context.manageMissingComponents,
    });
  } catch (syncError) {
    void vscode.window.showErrorMessage(
      `Assembly updated, but plugins failed to sync: ${String(syncError)}`,
    );
    context.assemblyStatusBar.setLastPublish({
      assemblyId: context.assemblyId,
      assemblyName: context.assemblyName,
      assemblyUri: context.assemblyUri,
      environment: context.env,
    });
    context.pluginExplorer?.refresh();
    return;
  }

  context.assemblyStatusBar.setLastPublish({
    assemblyId: context.assemblyId,
    assemblyName: context.assemblyName,
    assemblyUri: context.assemblyUri,
    environment: context.env,
  });
  vscode.window.showInformationMessage(
    buildAssemblySuccessMessage(context.assemblyName, context.env.name, pluginSummary, "updated"),
  );
  context.pluginExplorer?.refresh();
}

export async function validateAssemblyUpdateTarget(
  context: AssemblyUpdateValidationContext,
): Promise<boolean> {
  const [targetAssembly, localInspection] = await Promise.all([
    context.pluginService.getAssembly(context.assemblyId),
    context.pluginRegistration.inspectAssembly(context.assemblyUri.fsPath),
  ]);

  validateAssemblyIdentity(targetAssembly, localInspection.assembly);
  showVersionChangeWarning(targetAssembly, localInspection.assembly);

  return confirmPluginTypeOverlap(context, targetAssembly, localInspection);
}

export function validateAssemblyIdentity(
  targetAssembly: PluginAssembly,
  localAssembly: AssemblyIdentity,
): void {
  if (normalizeAssemblyName(targetAssembly.name) !== normalizeAssemblyName(localAssembly.name)) {
    throw new Error(
      `Selected CRM assembly is "${targetAssembly.name}", but the DLL is "${localAssembly.name}". Select the matching DLL for this assembly.`,
    );
  }

  const targetToken = normalizePublicKeyToken(targetAssembly.publicKeyToken);
  const localToken = normalizePublicKeyToken(localAssembly.publicKeyToken);
  if (targetToken && targetToken !== localToken) {
    throw new Error(
      `Selected CRM assembly "${targetAssembly.name}" has public key token "${targetToken}", but the DLL has "${localToken ?? "none"}". Select the matching signed DLL.`,
    );
  }

  const targetCulture = normalizeCulture(targetAssembly.culture);
  const localCulture = normalizeCulture(localAssembly.culture);
  if (targetCulture !== localCulture) {
    throw new Error(
      `Selected CRM assembly "${targetAssembly.name}" uses culture "${targetCulture ?? "neutral"}", but the DLL uses "${localCulture ?? "neutral"}". Select the matching DLL.`,
    );
  }
}

function showVersionChangeWarning(
  targetAssembly: PluginAssembly,
  localAssembly: AssemblyIdentity,
): void {
  const targetVersion = normalizeVersion(targetAssembly.version);
  const localVersion = normalizeVersion(localAssembly.version);
  if (targetVersion === localVersion) {
    return;
  }

  void vscode.window.showWarningMessage(
    `Plugin assembly version will change from ${targetVersion ?? "unknown"} to ${localVersion ?? "unknown"}.`,
  );
}

async function confirmPluginTypeOverlap(
  context: AssemblyUpdateValidationContext,
  targetAssembly: PluginAssembly,
  localInspection: PluginAssemblyInspection,
): Promise<boolean> {
  const existingTypes = await context.pluginService.listPluginTypes(context.assemblyId);
  const existingTypeNames = existingTypes
    .map((type) => normalizeTypeName(type.typeName))
    .filter((typeName): typeName is string => Boolean(typeName));
  if (!existingTypeNames.length) {
    return true;
  }

  const localTypeNames = new Set(
    localInspection.plugins
      .map((type) => normalizeTypeName(type.typeName))
      .filter((typeName): typeName is string => Boolean(typeName)),
  );
  const hasMatch = existingTypeNames.some((typeName) => localTypeNames.has(typeName));
  if (hasMatch) {
    return true;
  }

  const updateAnyway = "Update Anyway";
  const result = await vscode.window.showWarningMessage(
    `The DLL has no plugin types that match CRM assembly "${targetAssembly.name}". Continue only if this is expected.`,
    { modal: true },
    updateAnyway,
  );

  return result === updateAnyway;
}

function normalizeAssemblyName(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizePublicKeyToken(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized !== "none" && normalized !== "null" ? normalized : undefined;
}

function normalizeCulture(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized !== "neutral" && normalized !== "none" && normalized !== "null"
    ? normalized
    : undefined;
}

function normalizeVersion(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeTypeName(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

async function confirmAssemblyPublish(
  assemblyUri: vscode.Uri,
  env: EnvironmentConfig,
  assemblyName?: string,
): Promise<boolean> {
  const relative = vscode.workspace.asRelativePath(assemblyUri, false);
  const displayName = assemblyName ?? path.basename(assemblyUri.fsPath);
  const choice = await vscode.window.showWarningMessage(
    `Publish ${displayName} (${relative}) to ${env.name}?`,
    { modal: true },
    "Publish",
  );
  return choice === "Publish";
}

function formatPluginSyncResult(result: PluginSyncResult): string | undefined {
  const parts: string[] = [];
  if (result.created.length) parts.push(`${result.created.length} created`);
  if (result.updated.length) parts.push(`${result.updated.length} updated`);
  if (result.removed.length) parts.push(`${result.removed.length} removed`);
  if (result.skippedCreation.length) {
    parts.push(
      `${result.skippedCreation.length} creation skipped (manageMissingComponents is false): ${formatPluginNames(
        result.skippedCreation,
      )}`,
    );
  }
  if (result.skippedRemoval.length) {
    parts.push(
      `${result.skippedRemoval.length} removal skipped (manageMissingComponents is false): ${formatPluginNames(
        result.skippedRemoval,
      )}`,
    );
  }

  if (!parts.length) {
    return "Plugins: No plugin type changes detected.";
  }

  return `Plugins: ${parts.join(", ")}.`;
}

function formatPluginNames(plugins: Array<{ typeName?: string; name?: string }>): string {
  return plugins.map((plugin) => plugin.typeName || plugin.name || "unknown").join(", ");
}

type SnTool = {
  command: string;
  generateArgs: string[];
  publicArgs: string[];
  tokenArgs: string[];
};

async function resolveSnTool(): Promise<SnTool | undefined> {
  const candidates: SnTool[] = [
    { command: "sn", generateArgs: ["-k"], publicArgs: ["-p"], tokenArgs: ["-t"] },
    { command: "sn.exe", generateArgs: ["-k"], publicArgs: ["-p"], tokenArgs: ["-t"] },
  ];

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate.command, ["-?"]);
      return candidate;
    } catch {
      // Continue to next candidate
    }
  }

  return undefined;
}

async function createPluginService(
  connections: EnvironmentConnectionService,
  authContext: EnvironmentAuthContext,
  env: Parameters<EnvironmentConnectionService["createConnection"]>[0],
): Promise<PluginService> {
  const connection = await connections.createConnection(env, authContext);
  if (!connection) {
    throw new Error(`Authentication failed for ${env.name}.`);
  }
  const client = new DataverseClient(connection);
  const solutionComponents = new SolutionComponentService(client);
  return new PluginService(client, solutionComponents);
}
