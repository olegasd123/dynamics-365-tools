import * as path from "path";
import * as vscode from "vscode";
import { EnvironmentConfig } from "../../config/domain/models";
import { PluginAssembly, PluginType } from "../models";
import { PluginExplorerProvider } from "../pluginExplorer";
import { AssemblyIdentity, DiscoveredPluginType } from "../pluginAssemblyIntrospector";
import { PluginRegistrationManager, PluginSyncResult } from "../pluginRegistrationManager";
import { PluginService } from "../pluginService";
import { PluginAssemblyStatusBarService } from "../pluginAssemblyStatusBar";
import { LastSelectionService } from "../../../platform/vscode/lastSelectionStore";
import {
  AssemblyIdentityValidationError,
  validateAssemblyIdentity,
} from "./pluginAssemblyIdentity";
import type { NotificationPort } from "../../../app/ports/notifications";
import type { WorkspaceFilesPort } from "../../../app/ports/files";
import { NoopFileDialogs, type FileDialogPort } from "../../../app/ports/fileDialogs";
import { NoopProgress, type ProgressPort } from "../../../app/ports/progress";

type PluginSyncContext = {
  registration: PluginRegistrationManager;
  pluginService: PluginService;
  assemblyId: string;
  assemblyPath: string;
  solutionName?: string;
  manageMissingComponents?: boolean;
  progress?: ProgressPort;
};

export function buildAssemblySuccessMessage(
  assemblyName: string | undefined,
  envName: string,
  pluginSummary?: string,
  action: "registered" | "updated" = "registered",
): string {
  const normalizedName = assemblyName ?? "assembly";
  const base = `Plugin assembly ${normalizedName} has been ${action} in ${envName}.`;
  return pluginSummary ? `${base} ${pluginSummary}` : base;
}

export async function syncPluginsForAssembly(
  context: PluginSyncContext,
): Promise<string | undefined> {
  return formatPluginSyncResult(await runPluginSyncForAssembly(context));
}

async function runPluginSyncForAssembly(context: PluginSyncContext): Promise<PluginSyncResult> {
  const title = `Syncing plugins for ${path.basename(context.assemblyPath)}`;
  const progress = context.progress ?? new NoopProgress();
  return progress.withProgress({ title }, () =>
    context.registration.syncPluginTypes({
      pluginService: context.pluginService,
      assemblyId: context.assemblyId,
      assemblyPath: context.assemblyPath,
      solutionName: context.solutionName,
      manageMissingComponents: context.manageMissingComponents,
    }),
  );
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
  assemblyStatusBar: PluginAssemblyStatusBarService;
  lastSelection: LastSelectionService;
  notifications: NotificationPort;
  files: WorkspaceFilesPort;
  progress?: ProgressPort;
};

type AssemblyUpdateFileDialogContext = Omit<AssemblyUpdateContext, "assemblyUri"> & {
  defaultPath?: string;
  fileDialogs?: FileDialogPort;
};

type AssemblyUpdateValidationContext = {
  assemblyId: string;
  assemblyUri: vscode.Uri;
  pluginService: Pick<PluginService, "getAssembly" | "listPluginTypes">;
  pluginRegistration: Pick<PluginRegistrationManager, "inspectAssembly">;
  notifications: NotificationPort;
};

type AssemblyUpdatePreflight = {
  targetAssembly: PluginAssembly;
  diff: PluginComponentDiff;
};

type PluginComponentDiff = {
  deletedTypes: PluginType[];
  newTypes: DiscoveredPluginType[];
};

type PluginDeleteFailure = {
  plugin: PluginType;
  error: unknown;
};

export async function updateAssemblyFromFileDialog(
  context: AssemblyUpdateFileDialogContext,
): Promise<void> {
  const fileDialogs = context.fileDialogs ?? new NoopFileDialogs();
  while (true) {
    const assemblyFile = await fileDialogs.showOpenDialog({
      canSelectFolders: false,
      canSelectMany: false,
      filters: { Assemblies: ["dll"] },
      defaultPath: context.defaultPath,
      title: "Select updated plugin assembly (.dll)",
    });
    const assemblyPath = assemblyFile?.[0];
    if (!assemblyPath) {
      return;
    }

    try {
      await updateAssemblyFromUri({
        ...context,
        assemblyUri: vscode.Uri.file(assemblyPath),
      });
      return;
    } catch (error) {
      if (error instanceof AssemblyIdentityValidationError) {
        await context.notifications.askError(error.message, [], { modal: true });
        continue;
      }

      void context.notifications.error(`Failed to update plugin assembly: ${String(error)}`);
      return;
    }
  }
}

export async function updateAssemblyFromUri(context: AssemblyUpdateContext): Promise<void> {
  const preflight = await prepareAssemblyUpdate({
    assemblyId: context.assemblyId,
    assemblyUri: context.assemblyUri,
    pluginService: context.pluginService,
    pluginRegistration: context.pluginRegistration,
    notifications: context.notifications,
  });

  const content = await context.files.readFile(context.assemblyUri.fsPath);
  const contentBase64 = Buffer.from(content).toString("base64");

  const confirmed = await confirmPluginComponentChanges({
    assemblyName: context.assemblyName ?? preflight.targetAssembly.name,
    diff: preflight.diff,
    manageMissingComponents: context.manageMissingComponents,
    notifications: context.notifications,
  });
  if (!confirmed) {
    return;
  }

  const preUpdateSyncResult = await removeDeletedPluginTypesBeforeAssemblyUpdate(
    context,
    preflight.diff.deletedTypes,
  );

  await context.pluginService.updateAssembly(context.assemblyId, contentBase64);
  await context.lastSelection.setLastAssemblyDllPath(
    context.env.name,
    context.assemblyId,
    context.assemblyUri.fsPath,
  );

  let pluginSummary: string | undefined;
  try {
    const postUpdateSyncResult = await runPluginSyncForAssembly({
      registration: context.pluginRegistration,
      pluginService: context.pluginService,
      assemblyId: context.assemblyId,
      assemblyPath: context.assemblyUri.fsPath,
      solutionName: undefined,
      manageMissingComponents: context.manageMissingComponents,
      progress: context.progress,
    });
    pluginSummary = formatPluginSyncResult(
      mergePluginSyncResults(preUpdateSyncResult, postUpdateSyncResult),
    );
  } catch (syncError) {
    void context.notifications.error(
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
  await context.notifications.info(
    buildAssemblySuccessMessage(context.assemblyName, context.env.name, pluginSummary, "updated"),
  );
  context.pluginExplorer?.refresh();
}

export async function validateAssemblyUpdateTarget(
  context: AssemblyUpdateValidationContext,
): Promise<boolean> {
  await prepareAssemblyUpdate(context);
  return true;
}

async function prepareAssemblyUpdate(
  context: AssemblyUpdateValidationContext,
): Promise<AssemblyUpdatePreflight> {
  const [targetAssembly, localInspection] = await Promise.all([
    context.pluginService.getAssembly(context.assemblyId),
    context.pluginRegistration.inspectAssembly(context.assemblyUri.fsPath),
  ]);

  validateAssemblyIdentity(targetAssembly, localInspection.assembly);
  await showVersionChangeWarning(context.notifications, targetAssembly, localInspection.assembly);

  const existingTypes = await context.pluginService.listPluginTypes(context.assemblyId);

  return {
    targetAssembly,
    diff: buildPluginComponentDiff(existingTypes, localInspection.plugins),
  };
}

function showVersionChangeWarning(
  notifications: NotificationPort,
  targetAssembly: PluginAssembly,
  localAssembly: AssemblyIdentity,
): Promise<void> {
  const targetVersion = normalizeVersion(targetAssembly.version);
  const localVersion = normalizeVersion(localAssembly.version);
  if (targetVersion === localVersion) {
    return Promise.resolve();
  }

  return notifications.warning(
    `Plugin assembly version will change from ${targetVersion ?? "unknown"} to ${localVersion ?? "unknown"}.`,
  );
}

async function confirmPluginComponentChanges(context: {
  assemblyName: string;
  diff: PluginComponentDiff;
  manageMissingComponents: boolean;
  notifications: NotificationPort;
}): Promise<boolean> {
  const deletedCount = context.diff.deletedTypes.length;
  const newCount = context.diff.newTypes.length;
  if (!deletedCount && !newCount) {
    return true;
  }

  if (!context.manageMissingComponents && deletedCount) {
    await context.notifications.askError(
      `Plugin assembly ${context.assemblyName} cannot be updated because ${deletedCount} plugin type(s) were removed from the DLL and manageMissingComponents is false.`,
      [],
      {
        modal: true,
        detail: formatPluginComponentDiffDetail(context.diff, {
          includeDeleteWarning: false,
          includeManageMissingFalseBlock: true,
          includeSkippedCreationNote: newCount > 0,
        }),
      },
    );
    return false;
  }

  if (!context.manageMissingComponents) {
    const updateAssembly = "Update Assembly";
    const choice = await context.notifications.askWarning(
      `Update plugin assembly ${context.assemblyName} without creating ${newCount} new plugin type(s)?`,
      [updateAssembly],
      {
        modal: true,
        detail: formatPluginComponentDiffDetail(context.diff, {
          includeSkippedCreationNote: true,
        }),
      },
    );
    return choice === updateAssembly;
  }

  const action = deletedCount ? "Remove and Update" : "Update Assembly";
  const choice = await context.notifications.askWarning(
    `Update plugin assembly ${context.assemblyName} and sync ${deletedCount + newCount} plugin type change(s)?`,
    [action],
    {
      modal: true,
      detail: formatPluginComponentDiffDetail(context.diff, {
        includeDeleteWarning: deletedCount > 0,
      }),
    },
  );
  return choice === action;
}

async function removeDeletedPluginTypesBeforeAssemblyUpdate(
  context: AssemblyUpdateContext,
  deletedTypes: PluginType[],
): Promise<PluginSyncResult> {
  if (!deletedTypes.length || context.manageMissingComponents !== true) {
    return emptyPluginSyncResult();
  }

  const progress = context.progress ?? new NoopProgress();
  return progress.withProgress(
    { title: `Removing missing plugins for ${path.basename(context.assemblyUri.fsPath)}` },
    async () => {
      const removed: PluginType[] = [];
      const failures: PluginDeleteFailure[] = [];
      for (const plugin of deletedTypes) {
        try {
          await context.pluginService.deletePluginTypeCascade(plugin.id);
        } catch (error) {
          failures.push({ plugin, error });
          continue;
        }
        removed.push(plugin);
      }

      if (failures.length) {
        throw new Error(
          `Failed to delete ${failures.length} missing plugin type(s). Assembly was not updated because Dataverse still has plugin types that are missing from the DLL.\n${formatPluginDeleteFailures(
            failures,
          )}`,
        );
      }

      return {
        created: [],
        updated: [],
        removed,
        skippedCreation: [],
        skippedRemoval: [],
      };
    },
  );
}

function formatPluginDeleteFailures(failures: PluginDeleteFailure[]): string {
  const limit = 10;
  const lines = failures.slice(0, limit).map(({ plugin, error }) => {
    const name = plugin.typeName || plugin.name || "unknown";
    return `- ${name}: ${String(error)}`;
  });
  const remaining = failures.length - lines.length;
  if (remaining > 0) {
    lines.push(`- and ${remaining} more`);
  }

  return lines.join("\n");
}

function buildPluginComponentDiff(
  existingTypes: PluginType[],
  localPlugins: DiscoveredPluginType[],
): PluginComponentDiff {
  const existingByType = new Map<string, PluginType>();
  for (const plugin of existingTypes) {
    const key = normalizeTypeName(plugin.typeName);
    if (key) {
      existingByType.set(key, plugin);
    }
  }

  const localKeys = new Set<string>();
  const newTypes: DiscoveredPluginType[] = [];
  for (const plugin of localPlugins) {
    const key = normalizeTypeName(plugin.typeName);
    if (!key || localKeys.has(key)) {
      continue;
    }

    localKeys.add(key);
    if (!existingByType.has(key)) {
      newTypes.push(plugin);
    }
  }

  const deletedTypes = [...existingByType.entries()]
    .filter(([key]) => !localKeys.has(key))
    .map(([, plugin]) => plugin);

  return { deletedTypes, newTypes };
}

function normalizeVersion(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeTypeName(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export async function confirmAssemblyPublish(
  notifications: NotificationPort,
  assemblyUri: vscode.Uri,
  env: EnvironmentConfig,
  relativePath: string,
  assemblyName?: string,
): Promise<boolean> {
  const displayName = assemblyName ?? path.basename(assemblyUri.fsPath);
  const choice = await notifications.askWarning(
    `Publish ${displayName} (${relativePath}) to ${env.name}?`,
    ["Publish"],
    { modal: true },
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

function mergePluginSyncResults(
  first: PluginSyncResult,
  second: PluginSyncResult | undefined,
): PluginSyncResult {
  if (!second) {
    return first;
  }

  return {
    created: [...first.created, ...second.created],
    updated: [...first.updated, ...second.updated],
    removed: [...first.removed, ...second.removed],
    skippedCreation: [...first.skippedCreation, ...second.skippedCreation],
    skippedRemoval: [...first.skippedRemoval, ...second.skippedRemoval],
  };
}

function emptyPluginSyncResult(): PluginSyncResult {
  return {
    created: [],
    updated: [],
    removed: [],
    skippedCreation: [],
    skippedRemoval: [],
  };
}

function formatPluginNames(plugins: Array<{ typeName?: string; name?: string }>): string {
  return plugins.map((plugin) => plugin.typeName || plugin.name || "unknown").join(", ");
}

function formatPluginComponentDiffDetail(
  diff: PluginComponentDiff,
  options: {
    includeDeleteWarning?: boolean;
    includeManageMissingFalseBlock?: boolean;
    includeSkippedCreationNote?: boolean;
  } = {},
): string {
  const sections: string[] = [];
  if (options.includeManageMissingFalseBlock) {
    sections.push("The assembly cannot be updated because manageMissingComponents is false.");
  }
  if (options.includeSkippedCreationNote) {
    sections.push("New plugin types will not be created because manageMissingComponents is false.");
  }
  if (options.includeDeleteWarning && diff.deletedTypes.length) {
    sections.push("Related steps and images will also be deleted.");
  }
  if (diff.deletedTypes.length) {
    sections.push(`Removed from DLL:\n${formatPluginList(diff.deletedTypes)}`);
  }
  if (diff.newTypes.length) {
    sections.push(`New in DLL:\n${formatPluginList(diff.newTypes)}`);
  }

  return sections.join("\n\n");
}

function formatPluginList(plugins: Array<{ typeName?: string; name?: string }>): string {
  const limit = 30;
  const names = plugins
    .slice(0, limit)
    .map((plugin) => `- ${plugin.typeName || plugin.name || "unknown"}`);
  const remaining = plugins.length - names.length;
  if (remaining > 0) {
    names.push(`- and ${remaining} more`);
  }

  return names.join("\n");
}
