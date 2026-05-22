import type * as vscode from "vscode";
import type { AuthService } from "../features/auth/authService";
import type { AuthorizationStore } from "../features/auth/authorizationStore";
import type { SecretService } from "../features/auth/secretService";
import type { ConfigurationService } from "../features/config/configurationService";
import type { EnvironmentConnectionService } from "../features/dataverse/environmentConnectionService";
import type { PcfBuildService } from "../features/pcf/pcfBuildService";
import type { PcfDeployService } from "../features/pcf/pcfDeployService";
import type { PcfEnvironmentService } from "../features/pcf/pcfEnvironmentService";
import type { PacCli } from "../features/pcf/pacCli";
import type { PcfExplorerProvider } from "../features/pcf/pcfExplorer";
import type { NpmRunner } from "../features/pcf/npmRunner";
import type { PcfPackageService } from "../features/pcf/pcfPackageService";
import type { PcfProjectLocator } from "../features/pcf/pcfProjectLocator";
import type { PcfPushService } from "../features/pcf/pcfPushService";
import type { PcfStatusBarService } from "../features/pcf/pcfStatusBar";
import type { PcfTelemetryService } from "../features/pcf/pcfTelemetry";
import type { PcfWorkspaceSettingsService } from "../features/pcf/pcfWorkspaceSettings";
import type { ProcessRunner } from "../features/pcf/processRunner";
import type { PluginRegistrationManager } from "../features/plugins/pluginRegistrationManager";
import type { PluginExplorerProvider } from "../features/plugins/pluginExplorer";
import type { RibbonDiagnosticsService } from "../features/ribbons/ribbonDiagnostics";
import type { RibbonEditorState } from "../features/ribbons/ribbonEditorState";
import type { RibbonExplorerProvider } from "../features/ribbons/ribbonExplorer";
import type { RibbonRepository } from "../features/ribbons/ribbonRepository";
import type { RibbonSourceLocator } from "../features/ribbons/ribbonSourceLocator";
import type { SolutionZipService } from "../features/ribbons/solutionZipService";
import type { RibbonFormPanel } from "../features/ribbons/webview/ribbonFormPanel";
import type { BindingService } from "../features/webResources/bindingService";
import type { PublishCacheService } from "../features/webResources/publishCacheService";
import type { WebResourcePublisher } from "../features/webResources/webResourcePublisher";
import type { WebResourceUrlService } from "../features/webResources/webResourceUrlService";
import type { LastSelectionService } from "../platform/vscode/lastSelectionStore";
import type { AssemblyStatusBarService, StatusBarService } from "../platform/vscode/statusBar";
import type { SolutionPicker } from "../platform/vscode/ui/solutionPicker";

export interface CommandContext {
  extensionContext: vscode.ExtensionContext;

  configuration: ConfigurationService;
  ui: SolutionPicker;

  auth: AuthService;
  authorizations: AuthorizationStore;
  secrets: SecretService;
  lastSelection: LastSelectionService;

  bindings: BindingService;
  publishCache: PublishCacheService;
  publisher: WebResourcePublisher;
  webResources: WebResourceUrlService;

  connections: EnvironmentConnectionService;

  pluginExplorer: PluginExplorerProvider;
  pluginRegistration: PluginRegistrationManager;

  ribbonSourceLocator: RibbonSourceLocator;
  ribbonRepository: RibbonRepository;
  solutionZipService: SolutionZipService;
  ribbonEditorState: RibbonEditorState;
  ribbonDiagnostics: RibbonDiagnosticsService;
  ribbonExplorer: RibbonExplorerProvider;
  ribbonFormPanel: RibbonFormPanel;

  pcfProcessRunner: ProcessRunner;
  pacCli: PacCli;
  npmRunner: NpmRunner;
  pcfBuildService: PcfBuildService;
  pcfDeployService: PcfDeployService;
  pcfEnvironmentService: PcfEnvironmentService;
  pcfPackageService: PcfPackageService;
  pcfPushService: PcfPushService;
  pcfWorkspaceSettings: PcfWorkspaceSettingsService;
  pcfProjectLocator: PcfProjectLocator;
  pcfExplorer: PcfExplorerProvider;
  pcfStatusBar: PcfStatusBarService;
  pcfTelemetry: PcfTelemetryService;

  statusBar: StatusBarService;
  assemblyStatusBar: AssemblyStatusBarService;
}
