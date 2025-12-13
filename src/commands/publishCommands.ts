import * as vscode from "vscode";
import { ConfigurationService } from "../services/configurationService";
import { BindingService } from "../services/bindingService";
import { SolutionService } from "../services/solutionService";
import { PublisherService } from "../services/publisherService";
import { SecretService } from "../services/secretService";
import { AuthService } from "../services/authService";
import { StatusBarService } from "../services/statusBarService";
import { LastSelectionService } from "../services/lastSelectionService";
import { PublishCacheService } from "../services/publishCacheService";
import { BindingEntry, Dynamics365Configuration } from "../types";
import { resolveTargetUri, pickEnvironmentAndAuth } from "./common";
import { addBinding } from "./bindingCommands";
import {
  buildSupportedSet,
  collectSupportedFiles,
  ensureSupportedResource,
} from "./webResourceHelpers";

const FOLDER_PUBLISH_CONCURRENCY = 4;

export async function publishLastResource(
  configuration: ConfigurationService,
  bindings: BindingService,
  ui: SolutionService,
  publisher: PublisherService,
  secrets: SecretService,
  auth: AuthService,
  statusBar: StatusBarService,
  lastSelection: LastSelectionService,
  publishCache: PublishCacheService,
): Promise<void> {
  const last = statusBar.getLastPublish();
  if (!last) {
    vscode.window.showInformationMessage("Publish a resource first to enable quick publish.");
    return;
  }

  try {
    await vscode.workspace.fs.stat(last.targetUri);
  } catch {
    vscode.window.showWarningMessage("Last published resource no longer exists.");
    statusBar.clear();
    return;
  }

  const config = await configuration.loadConfiguration();
  const supportedExtensions = buildSupportedSet();
  const binding = (await bindings.getBinding(last.targetUri)) ?? last.binding;
  const preferredEnvName = last.environment.name;

  if (last.isFolder) {
    await publishFolder(
      binding,
      last.targetUri,
      supportedExtensions,
      configuration,
      bindings,
      ui,
      publisher,
      secrets,
      auth,
      statusBar,
      lastSelection,
      publishCache,
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
    config,
    preferredEnvName,
  );
}

export async function openResourceMenu(
  uri: vscode.Uri | undefined,
  configuration: ConfigurationService,
  bindings: BindingService,
  ui: SolutionService,
  publisher: PublisherService,
  secrets: SecretService,
  auth: AuthService,
  statusBar: StatusBarService,
  lastSelection: LastSelectionService,
  publishCache: PublishCacheService,
) {
  const targetUri = await resolveTargetUri(uri);
  if (!targetUri) {
    return;
  }

  const config = await configuration.loadConfiguration();
  const supportedExtensions = buildSupportedSet();

  if (!(await ensureSupportedResource(targetUri, supportedExtensions))) {
    return;
  }

  const binding = await bindings.getBinding(targetUri);
  if (!binding) {
    await addBinding(targetUri, configuration, bindings, ui);
    return;
  }

  const stat = await vscode.workspace.fs.stat(targetUri);
  if (binding.kind === "folder" && stat.type === vscode.FileType.Directory) {
    await publishFolder(
      binding,
      targetUri,
      supportedExtensions,
      configuration,
      bindings,
      ui,
      publisher,
      secrets,
      auth,
      statusBar,
      lastSelection,
      publishCache,
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
    config,
  );
}

export async function publishResource(
  uri: vscode.Uri | undefined,
  configuration: ConfigurationService,
  bindings: BindingService,
  ui: SolutionService,
  publisher: PublisherService,
  secrets: SecretService,
  auth: AuthService,
  statusBar: StatusBarService,
  lastSelection: LastSelectionService,
  publishCache: PublishCacheService,
): Promise<void> {
  const targetUri = await resolveTargetUri(uri);
  if (!targetUri) {
    return;
  }

  const config = await configuration.loadConfiguration();
  const supportedExtensions = buildSupportedSet();

  if (!(await ensureSupportedResource(targetUri, supportedExtensions))) {
    return;
  }

  const binding = await bindings.getBinding(targetUri);
  if (!binding) {
    const choice = await vscode.window.showInformationMessage(
      "This resource is not bound yet. Add a binding to publish it.",
      "Add Binding",
      "Cancel",
    );
    if (choice === "Add Binding") {
      await addBinding(targetUri, configuration, bindings, ui);
    }
    return;
  }

  const stat = await vscode.workspace.fs.stat(targetUri);
  if (binding.kind === "folder" && stat.type === vscode.FileType.Directory) {
    await publishFolder(
      binding,
      targetUri,
      supportedExtensions,
      configuration,
      bindings,
      ui,
      publisher,
      secrets,
      auth,
      statusBar,
      lastSelection,
      publishCache,
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
    config,
  );
}

async function publishFlow(
  binding: BindingEntry,
  targetUri: vscode.Uri,
  configuration: ConfigurationService,
  ui: SolutionService,
  publisher: PublisherService,
  secrets: SecretService,
  auth: AuthService,
  statusBar: StatusBarService,
  lastSelection: LastSelectionService,
  publishCache: PublishCacheService,
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
  ui: SolutionService,
  publisher: PublisherService,
  secrets: SecretService,
  auth: AuthService,
  statusBar: StatusBarService,
  lastSelection: LastSelectionService,
  publishCache: PublishCacheService,
  config?: Dynamics365Configuration,
  preferredEnvName?: string,
): Promise<void> {
  const files = await collectSupportedFiles(folderUri, supportedExtensions);
  if (!files.length) {
    vscode.window.showInformationMessage("No supported web resource files found in this folder.");
    return;
  }

  const publishAuth = await pickEnvironmentAndAuth(
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    config,
    preferredEnvName,
  );
  if (!publishAuth) {
    return;
  }

  let sharedAuth = { ...publishAuth.auth };
  if (!sharedAuth.accessToken && sharedAuth.credentials) {
    try {
      const token = await publisher.resolveToken(publishAuth.env, sharedAuth, false);
      if (token) {
        sharedAuth = { ...sharedAuth, accessToken: token };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Dynamics 365 Tools publish failed: ${message}`);
      return;
    }
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Publishing to ${publishAuth.env.name}…`,
      cancellable: true,
    },
    async (_progress, cancellationToken) => {
      files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
      const totals = { created: 0, updated: 0, skipped: 0, failed: 0 };
      let nextIndex = 0;
      let cancelled = false;
      const poolSize = Math.min(FOLDER_PUBLISH_CONCURRENCY, files.length);
      const workers = Array.from({ length: poolSize }, () =>
        (async (): Promise<void> => {
          while (true) {
            if (cancellationToken.isCancellationRequested || cancelled) {
              cancelled = true;
              break;
            }
            const currentIndex = nextIndex++;
            if (currentIndex >= files.length) {
              break;
            }
            const file = files[currentIndex];
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
        vscode.window.showWarningMessage(
          `Dynamics 365 Tools publish to ${publishAuth.env.name} cancelled: ${summary}.`,
        );
      }
    },
  );
}
