import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { ConfigurationService } from "../../config/configurationService";
import { BindingService } from "../bindingService";
import { SolutionPicker } from "../../../app/solutionPicker";
import { WebResourcePublisher } from "../webResourcePublisher";
import { SecretService } from "../../auth/secretService";
import { AuthService } from "../../auth/authService";
import { EnvironmentConnectionService } from "../../dataverse/environmentConnectionService";
import { WebResourceStatusBarService } from "../webResourceStatusBar";
import { LastSelectionService } from "../../../platform/vscode/lastSelectionStore";
import { PublishCacheService } from "../publishCacheService";
import {
  BindingEntry,
  Dynamics365Configuration,
  EnvironmentConfig,
} from "../../config/domain/models";
import { WorkspaceFileType, type WorkspaceFilesPort } from "../../../app/ports/files";
import type { NotificationPort } from "../../../app/ports/notifications";
import { resolveTargetUri, pickEnvironmentAndAuth } from "../../../app/commandUtils";
import { addBinding } from "./bindingCommands";
import {
  buildSupportedSet,
  collectSupportedFiles,
  ensureSupportedResource,
} from "../core/webResourceHelpers";

const FOLDER_PUBLISH_CONCURRENCY = 4;

export async function publishLastResource(ctx: CommandContext): Promise<void> {
  const {
    configuration,
    ui,
    secrets,
    auth,
    connections,
    statusBar,
    lastSelection,
    notifications,
    files,
  } = ctx.core;
  const { bindings, publisher, publishCache } = ctx.webResource;
  const last = statusBar.getLastPublish();
  if (!last) {
    await notifications.info("Publish a resource first to enable quick publish.");
    return;
  }

  try {
    await files.stat(last.targetUri.fsPath);
  } catch {
    await notifications.warning("Last published resource no longer exists.");
    statusBar.clear();
    return;
  }

  const config = await configuration.loadConfiguration();
  const supportedExtensions = buildSupportedSet();
  const binding = (await bindings.getBinding(last.targetUri)) ?? last.binding;
  const preferredEnvName = last.environment.name;
  const configuredEnvironment =
    config.environments.find((env) => env.name === preferredEnvName) ?? last.environment;

  if (
    !(await confirmPublishTarget(
      notifications,
      last.targetUri,
      configuredEnvironment,
      last.isFolder,
    ))
  ) {
    return;
  }

  if (last.isFolder) {
    await publishFolder(
      binding,
      last.targetUri,
      supportedExtensions,
      configuration,
      bindings,
      ui,
      publisher,
      connections,
      secrets,
      auth,
      statusBar,
      lastSelection,
      publishCache,
      notifications,
      files,
      config,
      preferredEnvName,
    );
    return;
  }

  await publishFlow(
    binding,
    last.targetUri,
    configuration,
    ui,
    publisher,
    secrets,
    auth,
    statusBar,
    lastSelection,
    publishCache,
    notifications,
    config,
    preferredEnvName,
  );
}

export async function openResourceMenu(ctx: CommandContext, uri: vscode.Uri | undefined) {
  const {
    configuration,
    ui,
    secrets,
    auth,
    connections,
    statusBar,
    lastSelection,
    notifications,
    files,
  } = ctx.core;
  const { bindings, publisher, publishCache } = ctx.webResource;
  const targetUri = await resolveTargetUri(notifications, uri);
  if (!targetUri) {
    return;
  }

  const config = await configuration.loadConfiguration();
  const supportedExtensions = buildSupportedSet();

  if (!(await ensureSupportedResource(targetUri, supportedExtensions, files, notifications))) {
    return;
  }

  const binding = await bindings.getBinding(targetUri);
  if (!binding) {
    await addBinding(ctx, targetUri);
    return;
  }

  const stat = await files.stat(targetUri.fsPath);
  if (binding.kind === "folder" && stat.type === WorkspaceFileType.Directory) {
    await publishFolder(
      binding,
      targetUri,
      supportedExtensions,
      configuration,
      bindings,
      ui,
      publisher,
      connections,
      secrets,
      auth,
      statusBar,
      lastSelection,
      publishCache,
      notifications,
      files,
      config,
    );
    return;
  }

  await publishFlow(
    binding,
    targetUri,
    configuration,
    ui,
    publisher,
    secrets,
    auth,
    statusBar,
    lastSelection,
    publishCache,
    notifications,
    config,
  );
}

export async function publishResource(
  ctx: CommandContext,
  uri: vscode.Uri | undefined,
): Promise<void> {
  const {
    configuration,
    ui,
    secrets,
    auth,
    connections,
    statusBar,
    lastSelection,
    notifications,
    files,
  } = ctx.core;
  const { bindings, publisher, publishCache } = ctx.webResource;
  const targetUri = await resolveTargetUri(notifications, uri);
  if (!targetUri) {
    return;
  }

  const config = await configuration.loadConfiguration();
  const supportedExtensions = buildSupportedSet();

  if (!(await ensureSupportedResource(targetUri, supportedExtensions, files, notifications))) {
    return;
  }

  const binding = await bindings.getBinding(targetUri);
  if (!binding) {
    const choice = await notifications.askInfo(
      "This resource is not bound yet. Add a binding to publish it.",
      ["Add Binding", "Cancel"],
    );
    if (choice === "Add Binding") {
      await addBinding(ctx, targetUri);
    }
    return;
  }

  const stat = await files.stat(targetUri.fsPath);
  if (binding.kind === "folder" && stat.type === WorkspaceFileType.Directory) {
    await publishFolder(
      binding,
      targetUri,
      supportedExtensions,
      configuration,
      bindings,
      ui,
      publisher,
      connections,
      secrets,
      auth,
      statusBar,
      lastSelection,
      publishCache,
      notifications,
      files,
      config,
    );
    return;
  }

  await publishFlow(
    binding,
    targetUri,
    configuration,
    ui,
    publisher,
    secrets,
    auth,
    statusBar,
    lastSelection,
    publishCache,
    notifications,
    config,
  );
}

async function publishFlow(
  binding: BindingEntry,
  targetUri: vscode.Uri,
  configuration: ConfigurationService,
  ui: SolutionPicker,
  publisher: WebResourcePublisher,
  secrets: SecretService,
  auth: AuthService,
  statusBar: WebResourceStatusBarService,
  lastSelection: LastSelectionService,
  publishCache: PublishCacheService,
  notifications: NotificationPort,
  config?: Dynamics365Configuration,
  preferredEnvName?: string,
) {
  const publishAuth = await pickEnvironmentAndAuth(
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    config,
    preferredEnvName,
    undefined,
    notifications,
  );
  if (!publishAuth) {
    return;
  }

  const result = await publisher.publish(binding, publishAuth.env, publishAuth.auth, targetUri, {
    cache: publishCache,
  });
  publisher.logSummary(result, publishAuth.env.name);
  statusBar.setLastPublish({
    binding,
    environment: publishAuth.env,
    targetUri,
    isFolder: false,
  });
}

async function publishFolder(
  folderBinding: BindingEntry,
  folderUri: vscode.Uri,
  supportedExtensions: Set<string>,
  configuration: ConfigurationService,
  bindings: BindingService,
  ui: SolutionPicker,
  publisher: WebResourcePublisher,
  connections: EnvironmentConnectionService,
  secrets: SecretService,
  auth: AuthService,
  statusBar: WebResourceStatusBarService,
  lastSelection: LastSelectionService,
  publishCache: PublishCacheService,
  notifications: NotificationPort,
  files: WorkspaceFilesPort,
  config?: Dynamics365Configuration,
  preferredEnvName?: string,
): Promise<void> {
  const publishAuth = await pickEnvironmentAndAuth(
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    config,
    preferredEnvName,
    undefined,
    notifications,
  );
  if (!publishAuth) {
    return;
  }

  let sharedAuth = { ...publishAuth.auth };
  if (!sharedAuth.accessToken && sharedAuth.credentials) {
    const connection = await connections.createConnection(publishAuth.env, sharedAuth);
    if (!connection) {
      return;
    }
    sharedAuth = { ...sharedAuth, accessToken: connection.token };
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Publishing to ${publishAuth.env.name}…`,
      cancellable: true,
    },
    async (progress, cancellationToken) => {
      progress.report({ message: "Scanning folder..." });
      const supportedFiles = await collectSupportedFiles(
        folderUri,
        supportedExtensions,
        files,
        cancellationToken,
      );
      if (cancellationToken.isCancellationRequested) {
        await notifications.warning(
          `Dynamics 365 Tools publish to ${publishAuth.env.name} cancelled: no files were processed.`,
        );
        return;
      }
      if (!supportedFiles.length) {
        await notifications.info("No supported web resource files found in this folder.");
        return;
      }

      progress.report({ message: `Publishing ${supportedFiles.length} file(s)...` });
      supportedFiles.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
      const totals = { created: 0, updated: 0, skipped: 0, failed: 0 };
      let nextIndex = 0;
      let cancelled = false;
      const poolSize = Math.min(FOLDER_PUBLISH_CONCURRENCY, supportedFiles.length);
      const workers = Array.from({ length: poolSize }, () =>
        (async (): Promise<void> => {
          while (true) {
            if (cancellationToken.isCancellationRequested || cancelled) {
              cancelled = true;
              break;
            }
            const currentIndex = nextIndex++;
            if (currentIndex >= supportedFiles.length) {
              break;
            }
            const file = supportedFiles[currentIndex];
            const isFirst = currentIndex === 0;
            // Use most specific binding for this file (file binding > folder binding)
            const fileBinding = (await bindings.getBinding(file)) ?? folderBinding;
            const result = await publisher.publish(fileBinding, publishAuth.env, sharedAuth, file, {
              isFirst: isFirst,
              cache: publishCache,
              cancellationToken,
            });
            totals.created += result.created;
            totals.updated += result.updated;
            totals.skipped += result.skipped;
            totals.failed += result.failed;
            if (result.cancelled || cancellationToken.isCancellationRequested) {
              cancelled = true;
              break;
            }
          }
        })(),
      );
      await Promise.all(workers);
      publisher.logSummary(totals, publishAuth.env.name, cancelled);
      if (!cancelled) {
        statusBar.setLastPublish({
          binding: folderBinding,
          environment: publishAuth.env,
          targetUri: folderUri,
          isFolder: true,
        });
      } else {
        const processed = totals.created + totals.updated + totals.skipped + totals.failed;
        const summary = processed
          ? `${processed} file(s) processed before cancellation`
          : "No files were processed";
        await notifications.warning(
          `Dynamics 365 Tools publish to ${publishAuth.env.name} cancelled: ${summary}.`,
        );
      }
    },
  );
}

function confirmPublishTarget(
  notifications: NotificationPort,
  targetUri: vscode.Uri,
  env: EnvironmentConfig,
  isFolder: boolean,
): Promise<boolean> {
  const relative = vscode.workspace.asRelativePath(targetUri, false);
  const target = isFolder ? `${relative}/` : relative;
  return (async () => {
    const result = await notifications.askWarning(
      `Publish ${target} to ${env.name}?`,
      ["Publish"],
      { modal: true },
    );
    return result === "Publish";
  })();
}
