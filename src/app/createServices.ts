import * as vscode from "vscode";
import { AuthService } from "../features/auth/authService";
import { AuthorizationStore } from "../features/auth/authorizationStore";
import { SecretService } from "../features/auth/secretService";
import { ConfigurationService } from "../features/config/configurationService";
import { EnvironmentConnectionService } from "../features/dataverse/environmentConnectionService";
import { NpmRunner } from "../features/pcf/npmRunner";
import { createPacCommandCandidates, PacCli } from "../features/pcf/pacCli";
import { PcfBuildService } from "../features/pcf/pcfBuildService";
import { PcfDeployService } from "../features/pcf/pcfDeployService";
import { PcfEnvironmentService } from "../features/pcf/pcfEnvironmentService";
import { PcfExplorerProvider } from "../features/pcf/pcfExplorer";
import { PcfPackageService } from "../features/pcf/pcfPackageService";
import { PcfProjectLocator } from "../features/pcf/pcfProjectLocator";
import { PcfPushService } from "../features/pcf/pcfPushService";
import { PcfStatusBarService } from "../features/pcf/pcfStatusBar";
import { PcfTelemetryService } from "../features/pcf/pcfTelemetry";
import { PcfWorkspaceSettingsService } from "../features/pcf/pcfWorkspaceSettings";
import { ProcessRunner } from "../features/pcf/processRunner";
import { PluginAssemblyIntrospector } from "../features/plugins/pluginAssemblyIntrospector";
import { PluginExplorerProvider } from "../features/plugins/pluginExplorer";
import { PluginRegistrationManager } from "../features/plugins/pluginRegistrationManager";
import { RibbonDiagnosticsService } from "../features/ribbons/ribbonDiagnostics";
import { RibbonEditorState } from "../features/ribbons/ribbonEditorState";
import { RibbonExplorerProvider } from "../features/ribbons/ribbonExplorer";
import { RibbonPublishService } from "../features/ribbons/ribbonPublishService";
import { RibbonRepository } from "../features/ribbons/ribbonRepository";
import { RibbonSourceLocator } from "../features/ribbons/ribbonSourceLocator";
import { SolutionZipService } from "../features/ribbons/solutionZipService";
import { RibbonFormPanel } from "../features/ribbons/webview/ribbonFormPanel";
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
  const ribbonSourceLocator = new RibbonSourceLocator();
  const ribbonRepository = new RibbonRepository();
  const ribbonPublishService = new RibbonPublishService();
  const solutionZipService = new SolutionZipService();
  const ribbonEditorState = new RibbonEditorState(ribbonRepository);
  const ribbonDiagnostics = new RibbonDiagnosticsService();
  const ribbonExplorer = new RibbonExplorerProvider(
    configuration,
    ribbonSourceLocator,
    ribbonEditorState,
    ribbonDiagnostics,
  );
  const ribbonFormPanel = new RibbonFormPanel();
  const pluginExplorer = new PluginExplorerProvider(
    configuration,
    connections,
    extensionContext.workspaceState,
  );
  await pluginExplorer.initialize();

  const pcfProcessRunner = new ProcessRunner();
  const pacCli = new PacCli(
    pcfProcessRunner,
    createPacCommandCandidates(extensionContext.globalStorageUri.fsPath),
  );
  const npmRunner = new NpmRunner(pcfProcessRunner);
  const pcfStatusBar = new PcfStatusBarService("dynamics365Tools.pcf.stopWatch");
  const pcfTelemetry = new PcfTelemetryService();
  const pcfBuildService = new PcfBuildService(npmRunner, pcfStatusBar, pcfTelemetry);
  const pcfEnvironmentService = new PcfEnvironmentService(connections);
  const pcfWorkspaceSettings = new PcfWorkspaceSettingsService(configuration);
  const pcfPushService = new PcfPushService(pacCli, pcfWorkspaceSettings, pcfTelemetry);
  const pcfDeployService = new PcfDeployService(
    connections,
    pcfWorkspaceSettings,
    configuration,
    pcfTelemetry,
  );
  const pcfPackageService = new PcfPackageService(
    pacCli,
    pcfProcessRunner,
    pcfWorkspaceSettings,
    configuration,
    pcfTelemetry,
  );
  const pcfProjectLocator = new PcfProjectLocator();
  await pcfProjectLocator.initialize();
  const pcfExplorer = new PcfExplorerProvider(
    configuration,
    extensionContext.workspaceState,
    pcfProjectLocator,
    pcfProcessRunner,
    pacCli,
    pcfBuildService,
    pcfEnvironmentService,
  );
  await pcfExplorer.initialize();

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
    ribbonSourceLocator,
    ribbonRepository,
    ribbonPublishService,
    solutionZipService,
    ribbonEditorState,
    ribbonDiagnostics,
    ribbonExplorer,
    ribbonFormPanel,
    pcfProcessRunner,
    pacCli,
    npmRunner,
    pcfBuildService,
    pcfDeployService,
    pcfEnvironmentService,
    pcfPackageService,
    pcfPushService,
    pcfWorkspaceSettings,
    pcfProjectLocator,
    pcfExplorer,
    pcfStatusBar,
    pcfTelemetry,
    statusBar,
    assemblyStatusBar,
  };
}
