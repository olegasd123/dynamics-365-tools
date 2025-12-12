import * as vscode from "vscode";
import * as path from "path";
import { ConfigurationService } from "../services/configurationService";
import { BindingService } from "../services/bindingService";
import { UiService } from "../services/uiService";
import { PublisherService } from "../services/publisherService";
import { SecretService } from "../services/secretService";
import { AuthService } from "../services/authService";
import { LastSelectionService } from "../services/lastSelectionService";
import { BindingEntry, Dynamics365Configuration } from "../types";
import { resolveTargetUri, pickEnvironmentAndAuth } from "./common";
import { buildSupportedSet, ensureSupportedResource } from "./webResourceHelpers";
import { addBinding } from "./bindingCommands";
import { WebResourceService } from "../services/webResourceService";

export async function openInCrm(
  uri: vscode.Uri | undefined,
  configuration: ConfigurationService,
  bindings: BindingService,
  ui: UiService,
  publisher: PublisherService,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  webResources: WebResourceService,
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
      "This resource is not bound yet. Add a binding to open it in CRM.",
      "Add Binding",
      "Cancel",
    );
    if (choice === "Add Binding") {
      await addBinding(targetUri, configuration, bindings, ui);
    }
    return;
  }

  const stat = await vscode.workspace.fs.stat(targetUri);
  if (stat.type !== vscode.FileType.File) {
    vscode.window.showInformationMessage("Select a file to open its web resource in CRM.");
    return;
  }

  const remotePath = resolveRemotePath(binding, targetUri, configuration);
  if (!remotePath) {
    return;
  }

  const openContext = await pickEnvironmentAndAuth(
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    config,
    undefined,
    { placeHolder: "Select environment to open in Power Apps" },
  );
  if (!openContext) {
    return;
  }

  const env = openContext.env;
  await lastSelection.setLastEnvironment(env.name);

  const token = await resolveTokenForOpen(env, openContext.auth, publisher);
  if (!token) {
    return;
  }

  const classicUrl = await webResources.buildClassicWebResourceUrl(
    env,
    token,
    binding.solutionName,
    remotePath,
  );
  if (!classicUrl) {
    return;
  }

  const opened = await vscode.env.openExternal(vscode.Uri.parse(classicUrl));
  if (!opened) {
    vscode.window.showErrorMessage(`Could not open web resource in ${env.name}.`);
  }
}

function resolveRemotePath(
  binding: BindingEntry,
  targetUri: vscode.Uri,
  configuration: ConfigurationService,
): string | undefined {
  const bindingRoot = configuration.resolveLocalPath(binding.relativeLocalPath);
  const targetPath = path.normalize(targetUri.fsPath);

  if (binding.kind === "folder") {
    const relative = path.relative(bindingRoot, targetPath);
    if (!relative || relative.startsWith("..")) {
      vscode.window.showErrorMessage("Selected file is outside the bound folder mapping.");
      return undefined;
    }
    return joinRemote(binding.remotePath, relative);
  }

  return binding.remotePath.replace(/\\/g, "/");
}

function joinRemote(base: string, relative: string): string {
  const normalizedBase = base.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedRelative = relative.replace(/\\/g, "/");
  return normalizedRelative ? `${normalizedBase}/${normalizedRelative}` : normalizedBase;
}

async function resolveTokenForOpen(
  env: Dynamics365Configuration["environments"][number],
  auth: {
    accessToken?: string;
    credentials?: Awaited<ReturnType<SecretService["getCredentials"]>>;
  },
  publisher: PublisherService,
): Promise<string | undefined> {
  if (auth.accessToken) {
    return auth.accessToken;
  }

  if (!auth.credentials) {
    vscode.window.showErrorMessage(
      "No credentials available. Sign in interactively or set client credentials first.",
    );
    return undefined;
  }

  try {
    return await publisher.resolveToken(env, { credentials: auth.credentials }, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Could not acquire token for ${env.name}: ${message}`);
    return undefined;
  }
}
