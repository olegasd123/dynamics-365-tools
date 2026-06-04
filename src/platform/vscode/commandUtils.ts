import * as vscode from "vscode";
import { AuthService } from "../../features/auth/authService";
import { SecretService } from "../../features/auth/secretService";
import { ConfigurationService } from "../../features/config/configurationService";
import { Dynamics365Configuration, EnvironmentConfig } from "../../features/config/domain/models";
import type { DataverseClient } from "../../features/dataverse/dataverseClient";
import type { EnvironmentAuthContext } from "../../features/dataverse/environmentConnectionService";
import type { CommandContext } from "../../app/commandContext";
import { LastSelectionService } from "./lastSelectionStore";
import { SolutionPicker } from "./ui/solutionPicker";

export async function resolveTargetUri(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
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

export async function pickEnvironmentAndAuth(
  configuration: ConfigurationService,
  ui: SolutionPicker,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  config?: Dynamics365Configuration,
  preferredEnvName?: string,
  pickOptions?: { placeHolder?: string },
): Promise<
  | {
      env: EnvironmentConfig;
      auth: {
        accessToken?: string;
        credentials?: Awaited<ReturnType<SecretService["getCredentials"]>>;
      };
    }
  | undefined
> {
  const resolvedConfig = config ?? (await configuration.loadConfiguration());
  let env: EnvironmentConfig | undefined;
  if (preferredEnvName) {
    env = resolvedConfig.environments.find((candidate) => candidate.name === preferredEnvName);
    if (!env) {
      vscode.window.showErrorMessage(`Environment ${preferredEnvName} is not configured.`);
      return undefined;
    }
  } else {
    const rememberedEnv = lastSelection.getLastEnvironment();
    env = await ui.pickEnvironment(resolvedConfig.environments, rememberedEnv, pickOptions);
    if (!env) {
      return undefined;
    }
  }

  await lastSelection.setLastEnvironment(env.name);

  const accessToken = env.authType !== "clientSecret" ? await auth.getAccessToken(env) : undefined;
  const credentials =
    env.authType === "clientSecret" || !accessToken
      ? await secrets.getCredentials(env.name)
      : undefined;

  if (!accessToken && !credentials) {
    vscode.window.showErrorMessage(
      "No credentials available. Sign in interactively or set client credentials first.",
    );
    return undefined;
  }

  return {
    env,
    auth: {
      accessToken,
      credentials,
    },
  };
}

export interface PickDataverseClientOptions {
  config?: Dynamics365Configuration;
  preferredEnvName?: string;
  placeHolder?: string;
}

export interface PickedDataverseClient {
  env: EnvironmentConfig;
  auth: EnvironmentAuthContext;
  client: DataverseClient;
}

export async function pickDataverseClient(
  ctx: CommandContext,
  options: PickDataverseClientOptions = {},
): Promise<PickedDataverseClient | undefined> {
  const target = await pickEnvironmentAndAuth(
    ctx.configuration,
    ctx.ui,
    ctx.secrets,
    ctx.auth,
    ctx.lastSelection,
    options.config,
    options.preferredEnvName,
    options.placeHolder ? { placeHolder: options.placeHolder } : undefined,
  );
  if (!target) {
    return undefined;
  }

  const client = await ctx.connections.createClient(target.env, target.auth);
  if (!client) {
    return undefined;
  }

  return {
    env: target.env,
    auth: target.auth,
    client,
  };
}
