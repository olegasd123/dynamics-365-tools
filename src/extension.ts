import * as vscode from "vscode";
import { ConfigurationService } from "./services/configurationService";
import { BindingService } from "./services/bindingService";
import { UiService } from "./services/uiService";
import { PublisherService } from "./services/publisherService";
import { SecretService } from "./services/secretService";
import { AuthService } from "./services/authService";
import { StatusBarService } from "./services/statusBarService";
import { LastSelectionService } from "./services/lastSelectionService";
import { PublishCacheService } from "./services/publishCacheService";
import { openResourceMenu, publishLastResource, publishResource } from "./commands/publishCommands";
import { openInCrm } from "./commands/openCommands";
import { addBinding } from "./commands/bindingCommands";
import { editConfiguration } from "./commands/configCommands";
import { setEnvironmentCredentials, signInInteractive, signOut } from "./commands/authCommands";
import { WebResourceService } from "./services/webResourceService";

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
  const webResources = new WebResourceService();

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
    vscode.commands.registerCommand("dynamics365Tools.openInCrm", async (uri?: vscode.Uri) =>
      openInCrm(
        uri,
        configuration,
        bindings,
        ui,
        publisher,
        secrets,
        auth,
        lastSelection,
        webResources,
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

export function deactivate() {}
