import type * as vscode from "vscode";
import type { AuthService } from "../features/auth/authService";
import type { SecretService } from "../features/auth/secretService";
import type { ConfigurationService } from "../features/config/configurationService";
import type { EnvironmentConnectionService } from "../features/dataverse/environmentConnectionService";
import type { PluginRegistrationManager } from "../features/plugins/pluginRegistrationManager";
import type { PluginExplorerProvider } from "../features/plugins/pluginExplorer";
import type { BindingService } from "../features/webResources/bindingService";
import type { PublishCacheService } from "../features/webResources/publishCacheService";
import type { WebResourcePublisher } from "../features/webResources/webResourcePublisher";
import type { WebResourceUrlService } from "../features/webResources/webResourceUrlService";
import type { LastSelectionService } from "../platform/vscode/lastSelectionStore";
import type { StatusBarService } from "../platform/vscode/statusBar";
import type { SolutionPicker } from "../platform/vscode/ui/solutionPicker";

export interface CommandContext {
  extensionContext: vscode.ExtensionContext;

  configuration: ConfigurationService;
  ui: SolutionPicker;

  auth: AuthService;
  secrets: SecretService;
  lastSelection: LastSelectionService;

  bindings: BindingService;
  publishCache: PublishCacheService;
  publisher: WebResourcePublisher;
  webResources: WebResourceUrlService;

  connections: EnvironmentConnectionService;

  pluginExplorer: PluginExplorerProvider;
  pluginRegistration: PluginRegistrationManager;

  statusBar: StatusBarService;
}
