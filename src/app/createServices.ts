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
import { PluginAssemblyStatusBarService } from "../features/plugins/pluginAssemblyStatusBar";
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
import { WebResourceStatusBarService } from "../features/webResources/webResourceStatusBar";
import { WebResourcePublisher } from "../features/webResources/webResourcePublisher";
import { WebResourceUrlService } from "../features/webResources/webResourceUrlService";
import { VsCodeAuthenticationService } from "../platform/vscode/authenticationService";
import { VsCodeClipboard } from "../platform/vscode/clipboard";
import { LastSelectionService } from "../platform/vscode/lastSelectionStore";
import { VsCodeNotificationService } from "../platform/vscode/notificationService";
import { VsCodeOutputPort } from "../platform/vscode/output";
import { VsCodeOutputLogger } from "../platform/vscode/outputLogger";
import { VsCodeSecretStore, VsCodeStateStore } from "../platform/vscode/storage";
import { VsCodeWorkbench } from "../platform/vscode/workbench";
import { VsCodeWorkspaceFiles } from "../platform/vscode/workspaceFiles";
import { CommandContext } from "./commandContext";
import { SolutionPicker } from "./solutionPicker";

export function createServices(extensionContext: vscode.ExtensionContext): CommandContext {
  const disposables: vscode.Disposable[] = [];

  const notifications = lazy(() => new VsCodeNotificationService());
  const logger = lazyDisposable(() => new VsCodeOutputLogger(), disposables);
  const output = lazy(() => new VsCodeOutputPort());
  const clipboard = lazy(() => new VsCodeClipboard());
  const files = lazy(() => new VsCodeWorkspaceFiles());
  const authentication = lazy(() => new VsCodeAuthenticationService());
  const workbench = lazy(() => new VsCodeWorkbench());
  const globalState = lazy(() => new VsCodeStateStore(extensionContext.globalState));
  const workspaceState = lazy(() => new VsCodeStateStore(extensionContext.workspaceState));
  const configuration = lazy(() => new ConfigurationService(files()));
  const ui = lazy(() => new SolutionPicker(notifications()));
  const secrets = lazy(() => new SecretService(new VsCodeSecretStore(extensionContext.secrets)));
  const auth = lazy(() => new AuthService(authentication(), notifications()));
  const authorizations = lazy(() => new AuthorizationStore(globalState()));
  const lastSelection = lazy(() => new LastSelectionService(workspaceState()));
  const connections = lazy(
    () => new EnvironmentConnectionService(auth(), secrets(), notifications()),
  );
  const statusBar = lazyDisposable(
    () => new WebResourceStatusBarService("dynamics365Tools.publishLastResource"),
    disposables,
  );
  const assemblyStatusBar = lazyDisposable(
    () => new PluginAssemblyStatusBarService("dynamics365Tools.plugins.publishLastAssembly"),
    disposables,
  );

  const bindings = lazy(() => new BindingService(configuration()));
  const publishCache = lazy(() => new PublishCacheService(configuration()));
  const publisher = lazy(
    () => new WebResourcePublisher(connections(), files(), notifications(), output(), clipboard()),
  );
  const webResources = lazy(() => new WebResourceUrlService(notifications()));

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
      notifications(),
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
      notifications(),
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
    () =>
      new PcfBuildService(npmRunner(), pcfStatusBar(), notifications(), pcfTelemetry(), output()),
    disposables,
  );
  const pcfEnvironmentService = lazy(() => new PcfEnvironmentService(connections()));
  const pcfWorkspaceSettings = lazy(
    () => new PcfWorkspaceSettingsService(configuration(), files()),
  );
  const pcfPushService = lazyDisposable(
    () =>
      new PcfPushService(
        pacCli(),
        pcfWorkspaceSettings(),
        notifications(),
        pcfTelemetry(),
        output(),
      ),
    disposables,
  );
  const pcfDeployService = lazyDisposable(
    () =>
      new PcfDeployService(
        connections(),
        pcfWorkspaceSettings(),
        configuration(),
        notifications(),
        pcfTelemetry(),
        output(),
      ),
    disposables,
  );
  const pcfPackageService = lazyDisposable(
    () =>
      new PcfPackageService(
        pacCli(),
        pcfProcessRunner(),
        pcfWorkspaceSettings(),
        configuration(),
        notifications(),
        pcfTelemetry(),
        output(),
      ),
    disposables,
  );
  const pcfProjectLocator = lazyDisposable(
    () => new PcfProjectLocator(undefined, notifications()),
    disposables,
  );
  const pcfExplorer = lazy(() => {
    return new PcfExplorerProvider(
      configuration(),
      extensionContext.workspaceState,
      pcfProjectLocator(),
      pcfProcessRunner(),
      pacCli(),
      pcfBuildService(),
      pcfEnvironmentService(),
      notifications(),
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
    get logger() {
      return logger();
    },
    get notifications() {
      return notifications();
    },
    get workbench() {
      return workbench();
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
