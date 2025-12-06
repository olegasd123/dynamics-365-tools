import * as vscode from "vscode";
import * as path from "path";
import { ConfigurationService } from "./services/configurationService";
import { BindingService } from "./services/bindingService";
import { UiService } from "./services/uiService";
import { PublisherService } from "./services/publisherService";
import { BindingEntry } from "./types";
import { SecretService } from "./services/secretService";
import { AuthService } from "./services/authService";

export async function activate(context: vscode.ExtensionContext) {
  const configuration = new ConfigurationService();
  const bindings = new BindingService(configuration);
  const ui = new UiService();
  const publisher = new PublisherService();
  const secrets = new SecretService(context.secrets);
  const auth = new AuthService();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "xrm.openResourceMenu",
      async (uri?: vscode.Uri) =>
        openResourceMenu(
          uri,
          configuration,
          bindings,
          ui,
          publisher,
          secrets,
          auth,
        ),
    ),
    vscode.commands.registerCommand(
      "xrm.publishResource",
      async (uri?: vscode.Uri) =>
        publishResource(uri, configuration, bindings, ui, publisher, secrets, auth),
    ),
    vscode.commands.registerCommand(
      "xrm.configureEnvironments",
      async () => editConfiguration(configuration),
    ),
    vscode.commands.registerCommand(
      "xrm.setDefaultSolution",
      async () => setDefaultSolution(configuration),
    ),
    vscode.commands.registerCommand(
      "xrm.bindResource",
      async (uri?: vscode.Uri) => addBinding(uri, configuration, bindings, ui),
    ),
    vscode.commands.registerCommand(
      "xrm.setEnvironmentCredentials",
      async () => setEnvironmentCredentials(configuration, ui, secrets),
    ),
    vscode.commands.registerCommand(
      "xrm.signInInteractive",
      async () => signInInteractive(configuration, ui, auth),
    ),
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
) {
  const targetUri = await resolveTargetUri(uri);
  if (!targetUri) {
    return;
  }

  if (!(await ensureSupportedResource(targetUri))) {
    return;
  }

  const binding = await bindings.getBinding(targetUri);
  if (!binding) {
    await addBinding(targetUri, configuration, bindings, ui);
    return;
  }

  await publishFlow(binding, targetUri, configuration, ui, publisher, secrets, auth);
}

async function publishResource(
  uri: vscode.Uri | undefined,
  configuration: ConfigurationService,
  bindings: BindingService,
  ui: UiService,
  publisher: PublisherService,
  secrets: SecretService,
  auth: AuthService,
): Promise<void> {
  const targetUri = await resolveTargetUri(uri);
  if (!targetUri) {
    return;
  }

  if (!(await ensureSupportedResource(targetUri))) {
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

  await publishFlow(binding, targetUri, configuration, ui, publisher, secrets, auth);
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
  const defaultSolutionConfig =
    config.solutions.find((s) => s.name === config.defaultSolution) ||
    config.solutions.find((s) => s.default) ||
    config.solutions[0];
  const defaultPrefix = defaultSolutionConfig?.prefix;
  const defaultRemote = buildDefaultRemotePath(relative, defaultPrefix);

  const remotePath = await ui.promptRemotePath(defaultRemote);
  if (!remotePath) {
    return;
  }

  const solutionConfig =
    (await ui.promptSolution(config.solutions, defaultSolutionConfig?.name)) ||
    defaultSolutionConfig;

  if (!solutionConfig) {
    vscode.window.showWarningMessage(
      "No solution selected. Binding was not created.",
    );
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

function buildDefaultRemotePath(
  relativePath: string,
  defaultPrefix?: string,
): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!defaultPrefix) {
    return normalized;
  }

  const prefix = defaultPrefix.replace(/[\\/]+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  const prefixIndex = segments.findIndex((segment) => segment === prefix);
  const trimmed =
    prefixIndex >= 0 ? segments.slice(prefixIndex).join("/") : normalized;

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
) {
  const config = await configuration.loadConfiguration();
  const env = await ui.pickEnvironment(config.environments);
  if (!env) {
    return;
  }

  const accessToken =
    env.authType !== "clientSecret"
      ? await auth.getAccessToken(env)
      : undefined;
  const creds =
    env.authType === "clientSecret" || !accessToken
      ? await secrets.getCredentials(env.name)
      : undefined;
  await publisher.publish(binding, env, {
    accessToken,
    credentials: creds,
  }, targetUri);
}

async function editConfiguration(
  configuration: ConfigurationService,
): Promise<void> {
  const config = await configuration.loadConfiguration();
  await configuration.saveConfiguration(config);
  const uri = vscode.Uri.joinPath(
    vscode.Uri.file(configuration.workspaceRoot || "."),
    ".vscode",
    "xrm.config.json",
  );
  await vscode.window.showTextDocument(uri);
}

async function setDefaultSolution(
  configuration: ConfigurationService,
): Promise<void> {
  const config = await configuration.loadConfiguration();
  const candidate =
    (await vscode.window.showInputBox({
      prompt:
        "Enter default solution unique name or pick an existing one to set it globally",
      value: config.defaultSolution,
      placeHolder: config.solutions.map((s) => s.name).join(", "),
    })) ?? config.defaultSolution;

  if (!candidate) {
    return;
  }

  config.defaultSolution = candidate;
  config.solutions = markDefault(config.solutions, candidate);
  await configuration.saveConfiguration(config);
  vscode.window.showInformationMessage(`Default solution set to ${candidate}.`);
}

function markDefault(
  solutions: {
    prefix: string;
    name: string;
    displayName?: string;
    default?: boolean;
  }[],
  defaultName: string,
) {
  return solutions.map((solution) => ({
    ...solution,
    default: solution.name === defaultName,
  }));
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
  vscode.window.showInformationMessage(
    `Credentials saved securely for environment ${env.name}.`,
  );
}

async function signInInteractive(
  configuration: ConfigurationService,
  ui: UiService,
  auth: AuthService,
): Promise<void> {
  const config = await configuration.loadConfiguration();
  const env = await ui.pickEnvironment(config.environments);
  if (!env) {
    return;
  }

  const token = await auth.getAccessToken(env);
  if (token) {
    vscode.window.showInformationMessage(`Signed in interactively for ${env.name}.`);
  }
}

async function resolveTargetUri(
  uri?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
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

async function ensureSupportedResource(uri: vscode.Uri): Promise<boolean> {
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.type === vscode.FileType.Directory) {
    return true;
  }

  const ext = path.extname(uri.fsPath).toLowerCase();
  const supported = new Set([
    ".js",
    ".ts",
    ".css",
    ".htm",
    ".html",
    ".xml",
    ".json",
    ".resx",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".xap",
    ".xsl",
    ".xslt",
    ".ico",
    ".svg",
  ]);

  if (!supported.has(ext)) {
    vscode.window.showInformationMessage(
      "XRM actions are available only for supported web resource types.",
    );
    return false;
  }

  return true;
}

export function deactivate() {}
