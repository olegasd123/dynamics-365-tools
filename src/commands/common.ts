import * as vscode from "vscode";
import { ConfigurationService } from "../services/configurationService";
import { SolutionService } from "../services/solutionService";
import { SecretService } from "../services/secretService";
import { AuthService } from "../services/authService";
import { LastSelectionService } from "../services/lastSelectionService";
import { Dynamics365Configuration } from "../types";

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
  ui: SolutionService,
  secrets: SecretService,
  auth: AuthService,
  lastSelection: LastSelectionService,
  config?: Dynamics365Configuration,
  preferredEnvName?: string,
  pickOptions?: { placeHolder?: string },
): Promise<
  | {
      env: Dynamics365Configuration["environments"][number];
      auth: {
        accessToken?: string;
        credentials?: Awaited<ReturnType<SecretService["getCredentials"]>>;
      };
    }
  | undefined
> {
  const resolvedConfig = config ?? (await configuration.loadConfiguration());
  let env: Dynamics365Configuration["environments"][number] | undefined;
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
