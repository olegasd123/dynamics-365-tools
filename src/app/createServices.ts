import * as vscode from "vscode";
import { AuthService } from "../features/auth/authService";
import { AuthorizationStore } from "../features/auth/authorizationStore";
import { SecretService } from "../features/auth/secretService";
import { ConfigurationService } from "../features/config/configurationService";
import { EnvironmentConnectionService } from "../features/dataverse/environmentConnectionService";
import { NpmRunner } from "../features/pcf/npmRunner";
import { PacCli } from "../features/pcf/pacCli";
import { PcfBuildService } from "../features/pcf/pcfBuildService";
import { PcfExplorerProvider } from "../features/pcf/pcfExplorer";
import { PcfProjectLocator } from "../features/pcf/pcfProjectLocator";
import { PcfPushService } from "../features/pcf/pcfPushService";
import { PcfStatusBarService } from "../features/pcf/pcfStatusBar";
import { PcfWorkspaceSettingsService } from "../features/pcf/pcfWorkspaceSettings";
import { ProcessRunner } from "../features/pcf/processRunner";
import { PluginAssemblyIntrospector } from "../features/plugins/pluginAssemblyIntrospector";
import { PluginExplorerProvider } from "../features/plugins/pluginExplorer";
import { PluginRegistrationManager } from "../features/plugins/pluginRegistrationManager";
import { BindingService } from "../features/webResources/bindingService";
import { PublishCacheService } from "../features/webResources/publishCacheService";
import { WebResourcePublisher } from "../features/webResources/webResourcePublisher";
import { WebResourceUrlService } from "../features/webResources/webResourceUrlService";
import { LastSelectionService } from "../platform/vscode/lastSelectionStore";
import { AssemblyStatusBarService, StatusBarService } from "../platform/vscode/statusBar";
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
  const authorizations = new AuthorizationStore(extensionContext.globalState);
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

  const pcfProcessRunner = new ProcessRunner();
  const pacCli = new PacCli(pcfProcessRunner);
  const npmRunner = new NpmRunner(pcfProcessRunner);
  const pcfStatusBar = new PcfStatusBarService("dynamics365Tools.pcf.stopWatch");
  const pcfBuildService = new PcfBuildService(npmRunner, pcfStatusBar);
  const pcfWorkspaceSettings = new PcfWorkspaceSettingsService(configuration);
  const pcfPushService = new PcfPushService(pacCli, pcfWorkspaceSettings);
  const pcfProjectLocator = new PcfProjectLocator();
  await pcfProjectLocator.initialize();
  const pcfExplorer = new PcfExplorerProvider(
    pcfProjectLocator,
    pcfProcessRunner,
    pacCli,
    pcfBuildService,
  );

  const statusBar = new StatusBarService("dynamics365Tools.publishLastResource");
  const assemblyStatusBar = new AssemblyStatusBarService(
    "dynamics365Tools.plugins.publishLastAssembly",
  );

  return {
    extensionContext,
    configuration,
    ui,
    secrets,
    auth,
    authorizations,
    lastSelection,
    bindings,
    publishCache,
    publisher,
    webResources,
    connections,
    pluginExplorer,
    pluginRegistration,
    pcfProcessRunner,
    pacCli,
    npmRunner,
    pcfBuildService,
    pcfPushService,
    pcfWorkspaceSettings,
    pcfProjectLocator,
    pcfExplorer,
    pcfStatusBar,
    statusBar,
    assemblyStatusBar,
  };
}
