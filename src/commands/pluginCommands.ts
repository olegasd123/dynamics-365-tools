import * as path from "path";
import * as vscode from "vscode";
import { promisify } from "util";
import { execFile } from "child_process";
import * as fs from "fs/promises";
import { pickEnvironmentAndAuth } from "./common";
import { ConfigurationService } from "../services/configurationService";
import { SolutionService } from "../services/solutionService";
import { SecretService } from "../services/secretService";
import { AuthService } from "../services/authService";
import { LastSelectionService } from "../services/lastSelectionService";
import {
  EnvironmentAuthContext,
  EnvironmentConnectionService,
} from "../services/environmentConnectionService";
import { PluginExplorerProvider } from "../plugins/pluginExplorer";
import { DataverseClient } from "../services/dataverseClient";
import { SolutionComponentService } from "../services/solutionComponentService";
import { PluginService } from "../plugins/pluginService";
import { PluginAssemblyNode } from "../plugins/pluginExplorer";
import {
  PluginRegistrationManager,
  PluginSyncResult,
} from "../plugins/pluginRegistrationManager";

const execFileAsync = promisify(execFile);

export async function registerPluginAssembly(
  configuration: ConfigurationService,
  ui: SolutionService,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  connections: EnvironmentConnectionService,
  registration: PluginRegistrationManager,
  explorer?: PluginExplorerProvider,
): Promise<void> {
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

  if (selection.env.createMissingComponents !== true) {
    void vscode.window.showWarningMessage(
      `Environment ${selection.env.name} is configured to block creating new solution components. Enable createMissingComponents to register plugin assemblies.`,
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
    try {
      const syncResult = await syncPluginsForAssembly({
        registration,
        pluginService: service,
        assemblyId,
        assemblyPath,
        solutionName: solution.name,
        allowCreate: true,
      });
      pluginSummary = syncResult;
    } catch (syncError) {
      void vscode.window.showErrorMessage(
        `Assembly registered, but plugins failed to sync: ${String(syncError)}`,
      );
    }

    vscode.window.showInformationMessage(
      buildAssemblySuccessMessage(name, selection.env.name, pluginSummary),
    );
    explorer?.refresh();
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to register plugin assembly: ${String(error)}`);
  }
}

export async function updatePluginAssembly(
  configuration: ConfigurationService,
  ui: SolutionService,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  connections: EnvironmentConnectionService,
  registration: PluginRegistrationManager,
  explorer?: PluginExplorerProvider,
  targetNode?: PluginAssemblyNode,
): Promise<void> {
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

  const selectedPath = assemblyFile[0].fsPath;
  const content = await vscode.workspace.fs.readFile(assemblyFile[0]);
  const contentBase64 = Buffer.from(content).toString("base64");

  try {
    await service.updateAssembly(assemblyId, contentBase64);
    await lastSelection.setLastAssemblyDllPath(env.name, assemblyId, selectedPath);
    let pluginSummary: string | undefined;
    try {
      const syncResult = await syncPluginsForAssembly({
        registration,
        pluginService: service,
        assemblyId,
        assemblyPath: selectedPath,
        solutionName: undefined,
        allowCreate: env.createMissingComponents === true,
      });
      pluginSummary = syncResult;
    } catch (syncError) {
      void vscode.window.showErrorMessage(
        `Assembly updated, but plugins failed to sync: ${String(syncError)}`,
      );
    }

    vscode.window.showInformationMessage(
      buildAssemblySuccessMessage(assemblyName, env.name, pluginSummary, "updated"),
    );
    explorer?.refresh();
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to update plugin assembly: ${String(error)}`);
  }
}

export async function generatePublicKeyToken(configuration: ConfigurationService): Promise<void> {
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
    const copyAction = token ? "Copy token" : undefined;
    const selection = await vscode.window.showInformationMessage(message, copyAction ?? "OK");
    if (selection === "Copy token" && token) {
      await vscode.env.clipboard.writeText(token);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to generate strong name key: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function extractToken(output?: string): string | undefined {
  if (!output) {
    return undefined;
  }
  const match =
    output.match(/Public key token is\s+([0-9a-fA-F]+)/i) ||
    output.match(/Public key token=(\w+)/i);
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
  allowCreate?: boolean;
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
        allowCreate: context.allowCreate,
      }),
  );

  return formatPluginSyncResult(result, context.allowCreate);
}

function formatPluginSyncResult(
  result: PluginSyncResult,
  allowCreate?: boolean,
): string | undefined {
  const parts: string[] = [];
  if (result.created.length) parts.push(`${result.created.length} created`);
  if (result.updated.length) parts.push(`${result.updated.length} updated`);
  if (result.removed.length) parts.push(`${result.removed.length} removed`);
  if (result.skippedCreation.length) {
    parts.push(`${result.skippedCreation.length} skipped (creation disabled)`);
  }

  if (!parts.length) {
    if (allowCreate === false && result.skippedCreation.length) {
      return "Plugins: creation skipped by environment settings.";
    }
    return "Plugins: no changes detected.";
  }

  return `Plugins: ${parts.join(", ")}.`;
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
