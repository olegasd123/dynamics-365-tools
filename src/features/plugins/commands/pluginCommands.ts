import * as path from "path";
import * as vscode from "vscode";
import { pickEnvironmentAndAuth } from "../../../app/commandUtils";
import { CommandContext } from "../../../app/commandContext";
import {
  EnvironmentAuthContext,
  EnvironmentConnectionService,
} from "../../dataverse/environmentConnectionService";
import { SolutionComponentService } from "../../dataverse/solutionComponentService";
import { PluginService } from "../pluginService";
import { PluginAssemblyNode } from "../pluginExplorer";
import {
  buildAssemblySuccessMessage,
  confirmAssemblyPublish,
  syncPluginsForAssembly,
  updateAssemblyFromFileDialog,
  updateAssemblyFromUri,
} from "./pluginAssemblyUpdateWorkflow";

export async function registerPluginAssembly(ctx: CommandContext): Promise<void> {
  const {
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    assemblyStatusBar,
    notifications,
    files,
    fileDialogs,
    input,
    progress,
  } = ctx.core;
  const { registration: pluginRegistration, explorer: pluginExplorer } = ctx.plugins;
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
    notifications,
  );
  if (!selection) {
    return;
  }

  if (selection.env.manageMissingComponents !== true) {
    void notifications.warning(
      `Environment ${selection.env.name} is configured to block missing component management. Enable manageMissingComponents to register plugin assemblies.`,
    );
    return;
  }

  const assemblyFile = await fileDialogs.showOpenDialog({
    canSelectFolders: false,
    canSelectMany: false,
    filters: { Assemblies: ["dll"] },
    title: "Select plugin assembly (.dll)",
  });
  const assemblyPath = assemblyFile?.[0];
  if (!assemblyPath) {
    return;
  }

  const defaultName = path.basename(assemblyPath, path.extname(assemblyPath));
  const name = await input.showInputBox({
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

  const content = await files.readFile(assemblyPath);
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
        progress,
      });
      pluginSummary = syncResult;
    } catch (syncError) {
      void notifications.error(
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
      await notifications.info(
        buildAssemblySuccessMessage(name, selection.env.name, pluginSummary),
      );
    }
    pluginExplorer?.refresh();
  } catch (error) {
    void notifications.error(`Failed to register plugin assembly: ${String(error)}`);
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
    assemblyStatusBar,
    notifications,
    files,
    fileDialogs,
    progress,
  } = ctx.core;
  const { registration: pluginRegistration, explorer: pluginExplorer } = ctx.plugins;
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
        notifications,
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
        notifications,
      );

  if (!selection) {
    return;
  }

  const env = selection.env;
  let service: PluginService;
  try {
    service = await createPluginService(connections, selection.auth, env);
  } catch (error) {
    void notifications.error(String(error));
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
      await notifications.info(`No plugin assemblies found in ${env.name}.`);
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
    await notifications.error("No plugin assembly selected for update.");
    return;
  }

  const lastDllPath = lastSelection.getLastAssemblyDllPath(env.name, assemblyId);
  const workspaceRoot = configuration.workspaceRoot ?? files.workspaceRoot;
  const defaultPath = lastDllPath ? path.dirname(lastDllPath) : workspaceRoot;

  await updateAssemblyFromFileDialog({
    assemblyId,
    assemblyName,
    defaultPath,
    env,
    manageMissingComponents: env.manageMissingComponents === true,
    pluginService: service,
    pluginRegistration,
    pluginExplorer,
    assemblyStatusBar,
    lastSelection,
    notifications,
    files,
    fileDialogs,
    progress,
  });
}

export async function publishLastPluginAssembly(ctx: CommandContext): Promise<void> {
  const {
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    connections,
    assemblyStatusBar,
    notifications,
    files,
  } = ctx.core;
  const { registration: pluginRegistration, explorer: pluginExplorer } = ctx.plugins;

  const last = assemblyStatusBar.getLastPublish();
  if (!last) {
    await notifications.info("Publish a plugin assembly first to enable quick publish.");
    return;
  }

  try {
    await files.stat(last.assemblyUri.fsPath);
  } catch {
    await notifications.warning("Last published plugin assembly no longer exists.");
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
    notifications,
  );
  if (!selection) {
    return;
  }

  const confirmed = await confirmAssemblyPublish(
    notifications,
    last.assemblyUri,
    selection.env,
    configuration.getRelativeToWorkspace(last.assemblyUri.fsPath),
    last.assemblyName,
  );
  if (!confirmed) {
    return;
  }

  let service: PluginService;
  try {
    service = await createPluginService(connections, selection.auth, selection.env);
  } catch (error) {
    void notifications.error(String(error));
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
      notifications,
      files,
    });
  } catch (error) {
    void notifications.error(`Failed to publish plugin assembly: ${String(error)}`);
  }
}

async function createPluginService(
  connections: EnvironmentConnectionService,
  authContext: EnvironmentAuthContext,
  env: Parameters<EnvironmentConnectionService["createConnection"]>[0],
): Promise<PluginService> {
  const client = await connections.createClient(env, authContext);
  if (!client) {
    throw new Error(`Authentication failed for ${env.name}.`);
  }
  const solutionComponents = new SolutionComponentService(client);
  return new PluginService(client, solutionComponents);
}

export {
  extractToken,
  generatePublicKeyToken,
  showPublicKeyTokenResult,
} from "./pluginPublicKeyCommands";

export {
  AssemblyIdentityValidationError,
  validateAssemblyIdentity,
} from "./pluginAssemblyIdentity";

export {
  updateAssemblyFromFileDialog,
  validateAssemblyUpdateTarget,
} from "./pluginAssemblyUpdateWorkflow";
