import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { buildDefaultEnvironmentUrl } from "../../../shared/environmentUrl";
import {
  EnvironmentConfig,
  Dynamics365Configuration,
  NormalizedEnvironmentConfig,
} from "../../config/domain/models";
import { AuthorizationProfile } from "../authorizationStore";

export async function setEnvironmentCredentials(ctx: CommandContext): Promise<void> {
  const { secrets, lastSelection, authorizations } = ctx;
  const env = await pickAuthorizationEnvironment(ctx, "clientSecret", {
    placeHolder: "Select authorization for client credentials",
    includeCreate: true,
    ensureProjectConfig: true,
  });
  if (!env) {
    return;
  }
  await lastSelection.setLastEnvironment(env.name);

  const clientId = await vscode.window.showInputBox({
    prompt: `Client ID for ${env.name}`,
    ignoreFocusOut: true,
    value: "",
  });
  if (!clientId) {
    return;
  }

  const tenantId = await vscode.window.showInputBox({
    prompt: `Tenant ID for ${env.name} (optional)`,
    ignoreFocusOut: true,
  });

  const clientSecret = await vscode.window.showInputBox({
    prompt: `Client Secret for ${env.name}`,
    password: true,
    ignoreFocusOut: true,
  });
  if (!clientSecret) {
    return;
  }

  await secrets.setCredentials(env.name, {
    clientId,
    clientSecret,
    tenantId,
  });
  await authorizations.save(environmentToProfile(env, "clientSecret"));
  vscode.window.showInformationMessage(`Credentials saved securely for environment ${env.name}.`);
}

export async function signInInteractive(ctx: CommandContext): Promise<void> {
  const { auth, lastSelection, authorizations } = ctx;
  const env = await pickAuthorizationEnvironment(ctx, "interactive", {
    placeHolder: "Select authorization for interactive sign-in",
    includeCreate: true,
    ensureProjectConfig: true,
    preferredName: lastSelection.getLastEnvironment(),
  });
  if (!env) {
    return;
  }

  await lastSelection.setLastEnvironment(env.name);

  const token = await auth.getAccessToken(env, { clearSessionPreference: true });
  if (token) {
    await authorizations.save(environmentToProfile(env, "interactive"));
    vscode.window.showInformationMessage(`Signed in interactively for ${env.name}.`);
  }
}

export async function signOut(ctx: CommandContext): Promise<void> {
  const { auth, secrets, lastSelection } = ctx;
  const env = await pickAuthorizationEnvironment(ctx, "interactive", {
    placeHolder: "Select authorization to sign out",
    includeCreate: false,
    ensureProjectConfig: false,
    preferredName: lastSelection.getLastEnvironment(),
  });
  if (!env) {
    return;
  }

  await lastSelection.setLastEnvironment(env.name);

  const signOutResult = await auth.signOut(env);
  const storedCreds = await secrets.getCredentials(env.name);
  let clearedCredentials = false;

  if (storedCreds) {
    const remove = await vscode.window.showInformationMessage(
      `Remove stored client credentials for ${env.name} as well?`,
      "Remove",
      "Keep",
    );
    if (remove === "Remove") {
      await secrets.clearCredentials(env.name);
      clearedCredentials = true;
    }
  }

  if (signOutResult === "failed") {
    if (clearedCredentials) {
      vscode.window.showInformationMessage(
        `Client credentials cleared for ${env.name}, but interactive sign-out failed (check errors).`,
      );
    }
    return;
  }

  const signedOut = signOutResult === "removed";
  if (signedOut || clearedCredentials) {
    const parts = [];
    if (signedOut) parts.push("signed out");
    if (clearedCredentials) parts.push("client credentials cleared");
    vscode.window.showInformationMessage(`Dynamics 365 Tools: ${env.name} ${parts.join(" and ")}.`);
  } else if (!storedCreds && signOutResult === "notFound") {
    vscode.window.showInformationMessage(
      `No interactive session or stored credentials found for ${env.name}.`,
    );
  }
}

type AuthorizationMode = "interactive" | "clientSecret";

interface PickAuthorizationOptions {
  placeHolder: string;
  includeCreate: boolean;
  ensureProjectConfig: boolean;
  preferredName?: string;
}

type AuthorizationPickItem = vscode.QuickPickItem & {
  env?: NormalizedEnvironmentConfig;
  createNew?: true;
};

async function pickAuthorizationEnvironment(
  ctx: CommandContext,
  mode: AuthorizationMode,
  options: PickAuthorizationOptions,
): Promise<NormalizedEnvironmentConfig | undefined> {
  const { configuration, authorizations } = ctx;
  const config = await configuration.loadExistingConfiguration();
  const configEnvs = config?.environments ?? [];
  const savedEnvs = authorizations
    .list()
    .map((profile) => authorizations.toEnvironment(profile, mode));

  const candidates: Array<{ env: NormalizedEnvironmentConfig; source: string }> = [];
  const byUrl = new Set<string>();

  for (const env of configEnvs) {
    const normalized = normalizeUrl(env.url);
    if (byUrl.has(normalized)) {
      continue;
    }
    byUrl.add(normalized);
    candidates.push({ env, source: "From this project config" });
  }

  for (const env of savedEnvs) {
    const normalized = normalizeUrl(env.url);
    if (byUrl.has(normalized)) {
      continue;
    }
    byUrl.add(normalized);
    candidates.push({ env, source: "Saved authorization" });
  }

  if (!candidates.length && options.includeCreate) {
    const created = await createAuthorization(mode);
    if (!created) {
      return undefined;
    }
    return finalizeAuthorizationSelection(ctx, created, mode, options.ensureProjectConfig);
  }

  if (!candidates.length) {
    vscode.window.showInformationMessage(
      "No authorizations found. Run 'Dynamics 365 Tools: Sign In (Interactive)' to create one.",
    );
    return undefined;
  }

  const preferred = options.preferredName?.toLowerCase();
  const items: AuthorizationPickItem[] = candidates.map(({ env, source }) => ({
    label: env.name,
    description: env.url,
    detail: source,
    env,
    picked: preferred ? env.name.toLowerCase() === preferred : false,
  }));
  if (options.includeCreate) {
    items.push({
      label: "$(add) Create new authorization...",
      detail: "Collect environment data and save it for future projects",
      createNew: true,
    });
  }

  const pick = await vscode.window.showQuickPick(items, { placeHolder: options.placeHolder });
  if (!pick) {
    return undefined;
  }

  if (pick.createNew) {
    const created = await createAuthorization(mode);
    if (!created) {
      return undefined;
    }
    return finalizeAuthorizationSelection(ctx, created, mode, options.ensureProjectConfig);
  }

  if (!pick.env) {
    return undefined;
  }

  return finalizeAuthorizationSelection(ctx, pick.env, mode, options.ensureProjectConfig);
}

async function finalizeAuthorizationSelection(
  ctx: CommandContext,
  env: NormalizedEnvironmentConfig,
  mode: AuthorizationMode,
  ensureProjectConfig: boolean,
): Promise<NormalizedEnvironmentConfig> {
  await ctx.authorizations.save(environmentToProfile(env, mode));
  if (ensureProjectConfig) {
    await ensureEnvironmentInProjectConfig(ctx, env);
  }
  return env;
}

async function createAuthorization(
  mode: AuthorizationMode,
): Promise<NormalizedEnvironmentConfig | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: "Authorization name (example: contoso-dev)",
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : "Name is required."),
  });
  if (!name) {
    return undefined;
  }

  const suggestedUrl = buildDefaultEnvironmentUrl(name);
  const url = await vscode.window.showInputBox({
    prompt: "Environment URL",
    ignoreFocusOut: true,
    value: suggestedUrl,
    validateInput: (value) => validateUrl(value),
  });
  if (!url) {
    return undefined;
  }

  const resource = await vscode.window.showInputBox({
    prompt: "Resource URL for token scope (optional)",
    ignoreFocusOut: true,
  });

  return toNormalizedEnvironment(
    {
      name,
      url,
      resource: resource?.trim() || undefined,
      authType: mode,
    },
    mode,
  );
}

async function ensureEnvironmentInProjectConfig(
  ctx: CommandContext,
  env: NormalizedEnvironmentConfig,
): Promise<void> {
  const { configuration, pluginExplorer } = ctx;
  const current = await configuration.loadExistingConfiguration();
  if (!current) {
    await configuration.saveConfiguration({
      environments: [env],
      solutions: [],
    });
    pluginExplorer.refresh();
    vscode.window.showInformationMessage(
      "Created .vscode/dynamics365tools.config.json with the selected authorization.",
    );
    return;
  }

  const index = findEnvironmentIndex(current, env);
  if (index < 0) {
    await configuration.saveConfiguration({
      ...current,
      environments: [...current.environments, env],
    });
    pluginExplorer.refresh();
    vscode.window.showInformationMessage(
      `Added environment ${env.name} to .vscode/dynamics365tools.config.json.`,
    );
    return;
  }

  const existing = current.environments[index];
  const merged: NormalizedEnvironmentConfig = {
    ...existing,
    name: env.name,
    url: env.url,
    resource: env.resource ?? existing.resource,
    authType: env.authType ?? existing.authType,
  };

  if (!sameEnvironment(existing, merged)) {
    const nextEnvironments = [...current.environments];
    nextEnvironments[index] = merged;
    await configuration.saveConfiguration({
      ...current,
      environments: nextEnvironments,
    });
    pluginExplorer.refresh();
  }
}

function findEnvironmentIndex(
  config: Dynamics365Configuration,
  env: NormalizedEnvironmentConfig,
): number {
  const byUrl = config.environments.findIndex(
    (item) => normalizeUrl(item.url) === normalizeUrl(env.url),
  );
  if (byUrl >= 0) {
    return byUrl;
  }

  return config.environments.findIndex(
    (item) => item.name.toLowerCase() === env.name.toLowerCase(),
  );
}

function sameEnvironment(a: NormalizedEnvironmentConfig, b: NormalizedEnvironmentConfig): boolean {
  return (
    a.name === b.name &&
    normalizeUrl(a.url) === normalizeUrl(b.url) &&
    (a.resource || "") === (b.resource || "") &&
    (a.authType || "") === (b.authType || "")
  );
}

function environmentToProfile(
  env: NormalizedEnvironmentConfig,
  mode: AuthorizationMode,
): AuthorizationProfile {
  return {
    name: env.name,
    url: env.url,
    resource: env.resource,
    authType: env.authType ?? mode,
  };
}

function toNormalizedEnvironment(
  env: EnvironmentConfig,
  fallbackAuthType: AuthorizationMode,
): NormalizedEnvironmentConfig {
  return {
    name: env.name.trim(),
    url: env.url.trim().replace(/\/+$/, ""),
    resource: env.resource?.trim() || undefined,
    authType: env.authType ?? fallbackAuthType,
    manageMissingComponents: env.manageMissingComponents ?? false,
    userAgentEnabled: env.userAgentEnabled ?? false,
    userAgent: env.userAgent,
  };
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function validateUrl(value: string): string | undefined {
  const url = value.trim();
  if (!url) {
    return "URL is required.";
  }
  if (!/^https?:\/\//i.test(url)) {
    return "URL must start with http:// or https://";
  }
  return undefined;
}
