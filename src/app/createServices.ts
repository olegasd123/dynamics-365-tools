import * as vscode from "vscode";
import { AuthService } from "../features/auth/authService";
import { SecretService } from "../features/auth/secretService";
import { ConfigurationService } from "../features/config/configurationService";
import { EnvironmentConnectionService } from "../features/dataverse/environmentConnectionService";
import { PluginAssemblyIntrospector } from "../features/plugins/pluginAssemblyIntrospector";
import { PluginExplorerProvider } from "../features/plugins/pluginExplorer";
import { PluginRegistrationManager } from "../features/plugins/pluginRegistrationManager";
import { BindingService } from "../features/webResources/bindingService";
import { PublishCacheService } from "../features/webResources/publishCacheService";
import { WebResourcePublisher } from "../features/webResources/webResourcePublisher";
import { WebResourceUrlService } from "../features/webResources/webResourceUrlService";
import { LastSelectionService } from "../platform/vscode/lastSelectionStore";
import { StatusBarService } from "../platform/vscode/statusBar";
import { SolutionPicker } from "../platform/vscode/ui/solutionPicker";
import { CommandContext } from "./commandContext";

export async function createServices(
  extensionContext: vscode.ExtensionContext,
): Promise<CommandContext> {
  const configuration = new ConfigurationService();
  const bindings = new BindingService(configuration);
  const ui = new SolutionPicker();

  const secrets = new SecretService(extensionContext.secrets);
  const auth = new AuthService();
  const lastSelection = new LastSelectionService(extensionContext.workspaceState);

  const publishCache = new PublishCacheService(configuration);
  const connections = new EnvironmentConnectionService(auth, secrets);

  const publisher = new WebResourcePublisher(connections);
  const webResources = new WebResourceUrlService();

  const pluginAssemblyIntrospector = new PluginAssemblyIntrospector(extensionContext.extensionPath);
  const pluginRegistration = new PluginRegistrationManager(pluginAssemblyIntrospector);
  const pluginExplorer = new PluginExplorerProvider(
    configuration,
    connections,
    extensionContext.workspaceState,
  );
  await pluginExplorer.initialize();

  const statusBar = new StatusBarService("dynamics365Tools.publishLastResource");

  return {
    extensionContext,
    configuration,
    ui,
    secrets,
    auth,
    lastSelection,
    bindings,
    publishCache,
    publisher,
    webResources,
    connections,
    pluginExplorer,
    pluginRegistration,
    statusBar,
  };
}
