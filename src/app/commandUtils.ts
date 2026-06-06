import * as vscode from "vscode";
import type { AuthService } from "../features/auth/authService";
import type { SecretService } from "../features/auth/secretService";
import type { ConfigurationService } from "../features/config/configurationService";
import type { Dynamics365Configuration, EnvironmentConfig } from "../features/config/domain/models";
import type { DataverseClient } from "../features/dataverse/dataverseClient";
import type { EnvironmentAuthContext } from "../features/dataverse/environmentConnectionService";
import type { LastSelectionService } from "../platform/vscode/lastSelectionStore";
import type { CommandContext } from "./commandContext";
import type { NotificationPort } from "./ports/notifications";
import type { SolutionPicker } from "./solutionPicker";

export async function resolveTargetUri(
  notifications: NotificationPort,
  uri?: vscode.Uri,
  activeFilePath?: string,
): Promise<vscode.Uri | undefined> {
  if (uri) {
    return uri;
  }

  if (activeFilePath) {
    return vscode.Uri.file(activeFilePath);
  }

  await notifications.info("Select a file or folder to proceed.");
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
  notifications?: NotificationPort,
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
      await notifications?.error(`Environment ${preferredEnvName} is not configured.`);
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
    await notifications?.error(
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
    ctx.core.configuration,
    ctx.core.ui,
    ctx.core.secrets,
    ctx.core.auth,
    ctx.core.lastSelection,
    options.config,
    options.preferredEnvName,
    options.placeHolder ? { placeHolder: options.placeHolder } : undefined,
    ctx.core.notifications,
  );
  if (!target) {
    return undefined;
  }

  const client = await ctx.core.connections.createClient(target.env, target.auth);
  if (!client) {
    return undefined;
  }

  return {
    env: target.env,
    auth: target.auth,
    client,
  };
}
