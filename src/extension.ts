import * as vscode from "vscode";
import * as path from "path";
import {
  ConfigurationService,
  WEB_RESOURCE_SUPPORTED_EXTENSIONS,
} from "./services/configurationService";
import { BindingService } from "./services/bindingService";
import { UiService } from "./services/uiService";
import { PublisherService } from "./services/publisherService";
import { BindingEntry, Dynamics365Configuration } from "./types";
import { SecretService } from "./services/secretService";
import { AuthService } from "./services/authService";
import { StatusBarService } from "./services/statusBarService";
import { LastSelectionService } from "./services/lastSelectionService";
import { PublishCacheService } from "./services/publishCacheService";

const FOLDER_PUBLISH_CONCURRENCY = 4;

export async function activate(context: vscode.ExtensionContext) {
  const configuration = new ConfigurationService();
  const bindings = new BindingService(configuration);
  const ui = new UiService();
  const publisher = new PublisherService();
  const secrets = new SecretService(context.secrets);
  const auth = new AuthService();
  const statusBar = new StatusBarService("dynamics365Tools.publishLastResource");
  const lastSelection = new LastSelectionService(context.workspaceState);
  const publishCache = new PublishCacheService(configuration);

  context.subscriptions.push(
    vscode.commands.registerCommand("dynamics365Tools.openResourceMenu", async (uri?: vscode.Uri) =>
      openResourceMenu(
        uri,
        configuration,
        bindings,
        ui,
        publisher,
        secrets,
        auth,
        statusBar,
        lastSelection,
        publishCache,
      ),
    ),
    vscode.commands.registerCommand("dynamics365Tools.publishResource", async (uri?: vscode.Uri) =>
      publishResource(
        uri,
        configuration,
        bindings,
        ui,
        publisher,
        secrets,
        auth,
        statusBar,
        lastSelection,
        publishCache,
      ),
    ),
    vscode.commands.registerCommand("dynamics365Tools.publishLastResource", async () =>
      publishLastResource(
        configuration,
        bindings,
        ui,
        publisher,
        secrets,
        auth,
        statusBar,
        lastSelection,
        publishCache,
      ),
    ),
    vscode.commands.registerCommand("dynamics365Tools.configureEnvironments", async () =>
      editConfiguration(configuration),
    ),
    vscode.commands.registerCommand("dynamics365Tools.bindResource", async (uri?: vscode.Uri) =>
      addBinding(uri, configuration, bindings, ui),
    ),
    vscode.commands.registerCommand("dynamics365Tools.setEnvironmentCredentials", async () =>
      setEnvironmentCredentials(configuration, ui, secrets),
    ),
    vscode.commands.registerCommand("dynamics365Tools.signInInteractive", async () =>
      signInInteractive(configuration, ui, auth, lastSelection),
    ),
    vscode.commands.registerCommand("dynamics365Tools.signOut", async () =>
      signOut(configuration, ui, auth, secrets, lastSelection),
    ),
    statusBar,
  );
}

async function publishLastResource(
  configuration: ConfigurationService,
  bindings: BindingService,
  ui: UiService,
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

async function openResourceMenu(
  uri: vscode.Uri | undefined,
  configuration: ConfigurationService,
  bindings: BindingService,
  ui: UiService,
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

async function publishResource(
  uri: vscode.Uri | undefined,
  configuration: ConfigurationService,
  bindings: BindingService,
  ui: UiService,
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

async function addBinding(
  uri: vscode.Uri | undefined,
  configuration: ConfigurationService,
  bindings: BindingService,
  ui: UiService,
): Promise<void> {
  const targetUri = await resolveTargetUri(uri);
  if (!targetUri) {
    return;
  }

  const config = await configuration.loadConfiguration();
  const stat = await vscode.workspace.fs.stat(targetUri);
  const kind = stat.type === vscode.FileType.Directory ? "folder" : "file";
  const relative = configuration.getRelativeToWorkspace(targetUri.fsPath);
  const solutionConfig = await ui.promptSolution(config.solutions);

  if (!solutionConfig) {
    vscode.window.showWarningMessage("No solution selected. Binding was not created.");
    return;
  }

  const defaultRemote = buildDefaultRemotePath(relative, solutionConfig.prefix);
  const remotePath = await ui.promptRemotePath(defaultRemote);
  if (!remotePath) {
    return;
  }

  const binding: BindingEntry = {
    relativeLocalPath: targetUri.fsPath,
    remotePath,
    solutionName: solutionConfig.name,
    kind,
  };

  await bindings.addOrUpdateBinding(binding);
  vscode.window.showInformationMessage(
    `Bound ${relative || targetUri.fsPath} to ${remotePath} (${solutionConfig.name}).`,
  );
}

function buildDefaultRemotePath(relativePath: string, defaultPrefix?: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!defaultPrefix) {
    return normalized;
  }

  const prefix = defaultPrefix.replace(/[\\/]+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  const prefixIndex = segments.findIndex((segment) => segment === prefix);
  const trimmed = prefixIndex >= 0 ? segments.slice(prefixIndex).join("/") : normalized;

  if (trimmed === prefix || trimmed.startsWith(`${prefix}/`)) {
    return trimmed;
  }

  return `${prefix}/${trimmed}`;
}

async function publishFlow(
  binding: BindingEntry,
  targetUri: vscode.Uri,
  configuration: ConfigurationService,
  ui: UiService,
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
  ui: UiService,
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

async function editConfiguration(configuration: ConfigurationService): Promise<void> {
  const config = await configuration.loadConfiguration();
  await configuration.saveConfiguration(config);
  const uri = vscode.Uri.joinPath(
    vscode.Uri.file(configuration.workspaceRoot || "."),
    ".vscode",
    "dynamics365tools.config.json",
  );
  await vscode.window.showTextDocument(uri);
}

async function setEnvironmentCredentials(
  configuration: ConfigurationService,
  ui: UiService,
  secrets: SecretService,
): Promise<void> {
  const config = await configuration.loadConfiguration();
  const env = await ui.pickEnvironment(config.environments);
  if (!env) {
    return;
  }

  const clientId = await vscode.window.showInputBox({
    prompt: `Client ID for ${env.name}`,
    ignoreFocusOut: true,
    value: "",
  });
  if (!clientId) {
    return;
  }

  const tenantId = await vscode.window.showInputBox({
    prompt: `Tenant ID for ${env.name} (optional)`,
    ignoreFocusOut: true,
  });

  const clientSecret = await vscode.window.showInputBox({
    prompt: `Client Secret for ${env.name}`,
    password: true,
    ignoreFocusOut: true,
  });
  if (!clientSecret) {
    return;
  }

  await secrets.setCredentials(env.name, {
    clientId,
    clientSecret,
    tenantId,
  });
  vscode.window.showInformationMessage(`Credentials saved securely for environment ${env.name}.`);
}

async function signInInteractive(
  configuration: ConfigurationService,
  ui: UiService,
  auth: AuthService,
  lastSelection: LastSelectionService,
): Promise<void> {
  const config = await configuration.loadConfiguration();
  const env = await ui.pickEnvironment(config.environments, lastSelection.getLastEnvironment());
  if (!env) {
    return;
  }

  await lastSelection.setLastEnvironment(env.name);

  const token = await auth.getAccessToken(env);
  if (token) {
    vscode.window.showInformationMessage(`Signed in interactively for ${env.name}.`);
  }
}

async function signOut(
  configuration: ConfigurationService,
  ui: UiService,
  auth: AuthService,
  secrets: SecretService,
  lastSelection: LastSelectionService,
): Promise<void> {
  const config = await configuration.loadConfiguration();
  const env = await ui.pickEnvironment(config.environments, lastSelection.getLastEnvironment());
  if (!env) {
    return;
  }

  await lastSelection.setLastEnvironment(env.name);

  const signOutResult = await auth.signOut(env);
  const storedCreds = await secrets.getCredentials(env.name);
  let clearedCredentials = false;

  if (storedCreds) {
    const remove = await vscode.window.showInformationMessage(
      `Remove stored client credentials for ${env.name} as well?`,
      "Remove",
      "Keep",
    );
    if (remove === "Remove") {
      await secrets.clearCredentials(env.name);
      clearedCredentials = true;
    }
  }

  if (signOutResult === "failed") {
    if (clearedCredentials) {
      vscode.window.showInformationMessage(
        `Client credentials cleared for ${env.name}, but interactive sign-out failed (check errors).`,
      );
    }
    return;
  }

  const signedOut = signOutResult === "removed";
  if (signedOut || clearedCredentials) {
    const parts = [];
    if (signedOut) parts.push("signed out");
    if (clearedCredentials) parts.push("client credentials cleared");
    vscode.window.showInformationMessage(`Dynamics 365 Tools: ${env.name} ${parts.join(" and ")}.`);
  } else if (!storedCreds && signOutResult === "notFound") {
    vscode.window.showInformationMessage(
      `No interactive session or stored credentials found for ${env.name}.`,
    );
  }
}

async function resolveTargetUri(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (uri) {
    return uri;
  }

  const editorUri = vscode.window.activeTextEditor?.document.uri;
  if (editorUri) {
    return editorUri;
  }

  vscode.window.showInformationMessage("Select a file or folder to proceed.");
  return undefined;
}

async function pickEnvironmentAndAuth(
  configuration: ConfigurationService,
  ui: UiService,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  config?: Dynamics365Configuration,
  preferredEnvName?: string,
): Promise<
  | {
      env: Dynamics365Configuration["environments"][number];
      auth: {
        accessToken?: string;
        credentials?: Awaited<ReturnType<SecretService["getCredentials"]>>;
      };
    }
  | undefined
> {
  const resolvedConfig = config ?? (await configuration.loadConfiguration());
  let env: Dynamics365Configuration["environments"][number] | undefined;
  if (preferredEnvName) {
    env = resolvedConfig.environments.find((candidate) => candidate.name === preferredEnvName);
    if (!env) {
      vscode.window.showErrorMessage(`Environment ${preferredEnvName} is not configured.`);
      return undefined;
    }
  } else {
    const rememberedEnv = lastSelection.getLastEnvironment();
    env = await ui.pickEnvironment(resolvedConfig.environments, rememberedEnv);
    if (!env) {
      return undefined;
    }
  }

  await lastSelection.setLastEnvironment(env.name);

  const accessToken = env.authType !== "clientSecret" ? await auth.getAccessToken(env) : undefined;
  const credentials =
    env.authType === "clientSecret" || !accessToken
      ? await secrets.getCredentials(env.name)
      : undefined;

  if (!accessToken && !credentials) {
    vscode.window.showErrorMessage(
      "No credentials available. Sign in interactively or set client credentials first.",
    );
    return undefined;
  }

  return {
    env,
    auth: {
      accessToken,
      credentials,
    },
  };
}

async function ensureSupportedResource(
  uri: vscode.Uri,
  supportedExtensions: Set<string>,
): Promise<boolean> {
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.type === vscode.FileType.Directory) {
    return true;
  }

  const ext = path.extname(uri.fsPath).toLowerCase();
  if (!isSupportedExtension(ext, supportedExtensions)) {
    vscode.window.showInformationMessage(
      "Dynamics 365 Tools actions are available only for supported web resource types.",
    );
    return false;
  }

  return true;
}

function isSupportedExtension(ext: string, supportedExtensions: Set<string>): boolean {
  return supportedExtensions.has(ext);
}

async function collectSupportedFiles(
  folder: vscode.Uri,
  supportedExtensions: Set<string>,
): Promise<vscode.Uri[]> {
  const entries = await vscode.workspace.fs.readDirectory(folder);
  const files: vscode.Uri[] = [];

  for (const [name, type] of entries) {
    const child = vscode.Uri.joinPath(folder, name);
    if (type === vscode.FileType.Directory) {
      files.push(...(await collectSupportedFiles(child, supportedExtensions)));
    } else if (
      type === vscode.FileType.File &&
      isSupportedExtension(path.extname(name).toLowerCase(), supportedExtensions)
    ) {
      files.push(child);
    }
  }

  return files;
}

function buildSupportedSet(): Set<string> {
  return new Set(WEB_RESOURCE_SUPPORTED_EXTENSIONS.map((ext) => ext.toLowerCase()));
}

export function deactivate() {}
