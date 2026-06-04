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

export function createServices(extensionContext: vscode.ExtensionContext): CommandContext {
  const disposables: vscode.Disposable[] = [];

  const configuration = lazy(() => new ConfigurationService());
  const ui = lazy(() => new SolutionPicker());
  const secrets = lazy(() => new SecretService(extensionContext.secrets));
  const auth = lazy(() => new AuthService());
  const authorizations = lazy(() => new AuthorizationStore(extensionContext.globalState));
  const lastSelection = lazy(() => new LastSelectionService(extensionContext.workspaceState));
  const connections = lazy(() => new EnvironmentConnectionService(auth(), secrets()));
  const statusBar = lazyDisposable(
    () => new StatusBarService("dynamics365Tools.publishLastResource"),
    disposables,
  );
  const assemblyStatusBar = lazyDisposable(
    () => new AssemblyStatusBarService("dynamics365Tools.plugins.publishLastAssembly"),
    disposables,
  );

  const bindings = lazy(() => new BindingService(configuration()));
  const publishCache = lazy(() => new PublishCacheService(configuration()));
  const publisher = lazy(() => new WebResourcePublisher(connections()));
  const webResources = lazy(() => new WebResourceUrlService());

  const pluginAssemblyIntrospector = lazy(
    () => new PluginAssemblyIntrospector(extensionContext.extensionPath),
  );
  const pluginRegistration = lazy(
    () => new PluginRegistrationManager(pluginAssemblyIntrospector()),
  );
  const pluginExplorer = lazy(() => {
    return new PluginExplorerProvider(
      configuration(),
      connections(),
      extensionContext.workspaceState,
    );
  });

  const ribbonSourceLocator = lazy(() => new RibbonSourceLocator());
  const ribbonRepository = lazy(() => new RibbonRepository());
  const ribbonPublishService = lazy(() => new RibbonPublishService());
  const solutionZipService = lazy(() => new SolutionZipService());
  const ribbonEditorState = lazy(() => new RibbonEditorState(ribbonRepository()));
  const ribbonDiagnostics = lazyDisposable(() => new RibbonDiagnosticsService(), disposables);
  const ribbonExplorer = lazy(() => {
    return new RibbonExplorerProvider(
      configuration(),
      ribbonSourceLocator(),
      ribbonEditorState(),
      ribbonDiagnostics(),
    );
  });
  const ribbonFormPanel = lazyDisposable(() => new RibbonFormPanel(), disposables);

  const pcfProcessRunner = lazyDisposable(() => new ProcessRunner(), disposables);
  const pacCli = lazy(() => {
    return new PacCli(
      pcfProcessRunner(),
      createPacCommandCandidates(extensionContext.globalStorageUri.fsPath),
    );
  });
  const npmRunner = lazy(() => new NpmRunner(pcfProcessRunner()));
  const pcfStatusBar = lazyDisposable(
    () => new PcfStatusBarService("dynamics365Tools.pcf.stopWatch"),
    disposables,
  );
  const pcfTelemetry = lazyDisposable(() => new PcfTelemetryService(), disposables);
  const pcfBuildService = lazyDisposable(
    () => new PcfBuildService(npmRunner(), pcfStatusBar(), pcfTelemetry()),
    disposables,
  );
  const pcfEnvironmentService = lazy(() => new PcfEnvironmentService(connections()));
  const pcfWorkspaceSettings = lazy(() => new PcfWorkspaceSettingsService(configuration()));
  const pcfPushService = lazyDisposable(
    () => new PcfPushService(pacCli(), pcfWorkspaceSettings(), pcfTelemetry()),
    disposables,
  );
  const pcfDeployService = lazyDisposable(
    () =>
      new PcfDeployService(connections(), pcfWorkspaceSettings(), configuration(), pcfTelemetry()),
    disposables,
  );
  const pcfPackageService = lazyDisposable(
    () =>
      new PcfPackageService(
        pacCli(),
        pcfProcessRunner(),
        pcfWorkspaceSettings(),
        configuration(),
        pcfTelemetry(),
      ),
    disposables,
  );
  const pcfProjectLocator = lazyDisposable(() => new PcfProjectLocator(), disposables);
  const pcfExplorer = lazy(() => {
    return new PcfExplorerProvider(
      configuration(),
      extensionContext.workspaceState,
      pcfProjectLocator(),
      pcfProcessRunner(),
      pacCli(),
      pcfBuildService(),
      pcfEnvironmentService(),
    );
  });

  const core = {
    get configuration() {
      return configuration();
    },
    get ui() {
      return ui();
    },
    get auth() {
      return auth();
    },
    get authorizations() {
      return authorizations();
    },
    get secrets() {
      return secrets();
    },
    get lastSelection() {
      return lastSelection();
    },
    get connections() {
      return connections();
    },
    get statusBar() {
      return statusBar();
    },
    get assemblyStatusBar() {
      return assemblyStatusBar();
    },
  };

  const webResource = {
    get bindings() {
      return bindings();
    },
    get publishCache() {
      return publishCache();
    },
    get publisher() {
      return publisher();
    },
    get urls() {
      return webResources();
    },
  };

  const plugins = {
    get explorer() {
      return pluginExplorer();
    },
    get registration() {
      return pluginRegistration();
    },
  };

  const ribbon = {
    get sourceLocator() {
      return ribbonSourceLocator();
    },
    get repository() {
      return ribbonRepository();
    },
    get publishService() {
      return ribbonPublishService();
    },
    get solutionZipService() {
      return solutionZipService();
    },
    get editorState() {
      return ribbonEditorState();
    },
    get diagnostics() {
      return ribbonDiagnostics();
    },
    get explorer() {
      return ribbonExplorer();
    },
    get formPanel() {
      return ribbonFormPanel();
    },
  };

  const pcf = {
    get processRunner() {
      return pcfProcessRunner();
    },
    get pacCli() {
      return pacCli();
    },
    get npmRunner() {
      return npmRunner();
    },
    get buildService() {
      return pcfBuildService();
    },
    get deployService() {
      return pcfDeployService();
    },
    get environmentService() {
      return pcfEnvironmentService();
    },
    get packageService() {
      return pcfPackageService();
    },
    get pushService() {
      return pcfPushService();
    },
    get workspaceSettings() {
      return pcfWorkspaceSettings();
    },
    get projectLocator() {
      return pcfProjectLocator();
    },
    get explorer() {
      return pcfExplorer();
    },
    get statusBar() {
      return pcfStatusBar();
    },
    get telemetry() {
      return pcfTelemetry();
    },
  };

  return {
    extensionContext,
    core,
    webResource,
    plugins,
    ribbon,
    pcf,
    get configuration() {
      return core.configuration;
    },
    get ui() {
      return core.ui;
    },
    get secrets() {
      return core.secrets;
    },
    get auth() {
      return core.auth;
    },
    get authorizations() {
      return core.authorizations;
    },
    get lastSelection() {
      return core.lastSelection;
    },
    get bindings() {
      return webResource.bindings;
    },
    get publishCache() {
      return webResource.publishCache;
    },
    get publisher() {
      return webResource.publisher;
    },
    get webResources() {
      return webResource.urls;
    },
    get connections() {
      return core.connections;
    },
    get pluginExplorer() {
      return plugins.explorer;
    },
    get pluginRegistration() {
      return plugins.registration;
    },
    get ribbonSourceLocator() {
      return ribbon.sourceLocator;
    },
    get ribbonRepository() {
      return ribbon.repository;
    },
    get ribbonPublishService() {
      return ribbon.publishService;
    },
    get solutionZipService() {
      return ribbon.solutionZipService;
    },
    get ribbonEditorState() {
      return ribbon.editorState;
    },
    get ribbonDiagnostics() {
      return ribbon.diagnostics;
    },
    get ribbonExplorer() {
      return ribbon.explorer;
    },
    get ribbonFormPanel() {
      return ribbon.formPanel;
    },
    get pcfProcessRunner() {
      return pcf.processRunner;
    },
    get pacCli() {
      return pcf.pacCli;
    },
    get npmRunner() {
      return pcf.npmRunner;
    },
    get pcfBuildService() {
      return pcf.buildService;
    },
    get pcfDeployService() {
      return pcf.deployService;
    },
    get pcfEnvironmentService() {
      return pcf.environmentService;
    },
    get pcfPackageService() {
      return pcf.packageService;
    },
    get pcfPushService() {
      return pcf.pushService;
    },
    get pcfWorkspaceSettings() {
      return pcf.workspaceSettings;
    },
    get pcfProjectLocator() {
      return pcf.projectLocator;
    },
    get pcfExplorer() {
      return pcf.explorer;
    },
    get pcfStatusBar() {
      return pcf.statusBar;
    },
    get pcfTelemetry() {
      return pcf.telemetry;
    },
    get statusBar() {
      return core.statusBar;
    },
    get assemblyStatusBar() {
      return core.assemblyStatusBar;
    },
    dispose() {
      for (const disposable of disposables.splice(0).reverse()) {
        disposable.dispose();
      }
    },
  };
}

function lazy<T>(factory: () => T): () => T {
  let value: T | undefined;
  return () => {
    value ??= factory();
    return value;
  };
}

function lazyDisposable<T extends vscode.Disposable>(
  factory: () => T,
  disposables: vscode.Disposable[],
): () => T {
  let value: T | undefined;
  return () => {
    if (!value) {
      value = factory();
      disposables.push(value);
    }
    return value;
  };
}
