import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { buildDefaultEnvironmentUrl } from "../../../shared/environmentUrl";
import { DataverseClient, isDefaultSolution } from "../../dataverse/dataverseClient";
import {
  Dynamics365Configuration,
  NormalizedEnvironmentConfig,
  SolutionConfig,
} from "../domain/models";

export async function editConfiguration(ctx: CommandContext): Promise<void> {
  const { configuration } = ctx;
  const config = await configuration.loadConfiguration();
  await configuration.saveConfiguration(config);
  const uri = vscode.Uri.joinPath(
    vscode.Uri.file(configuration.workspaceRoot || "."),
    ".vscode",
    "dynamics365tools.config.json",
  );
  await vscode.window.showTextDocument(uri);
  ctx.pluginExplorer.refresh();
}

type SolutionPickItem = vscode.QuickPickItem & {
  solution?: {
    uniqueName: string;
    friendlyName?: string;
    publisherPrefix?: string;
  };
};

export async function addEnvironment(ctx: CommandContext): Promise<void> {
  const { configuration, pluginExplorer } = ctx;
  const current = await loadOrCreateEmptyConfig(configuration);

  const name = await vscode.window.showInputBox({
    prompt: "Environment name",
    ignoreFocusOut: true,
    validateInput: (value) => validateEnvironmentName(value),
  });
  if (!name) {
    return;
  }

  const url = await vscode.window.showInputBox({
    prompt: "Environment URL",
    value: buildDefaultEnvironmentUrl(name),
    ignoreFocusOut: true,
    validateInput: (value) => validateUrl(value),
  });
  if (!url) {
    return;
  }

  const resource = await vscode.window.showInputBox({
    prompt: "Resource URL for token scope (optional)",
    ignoreFocusOut: true,
  });

  const authPick = await vscode.window.showQuickPick(
    [
      {
        label: "Interactive",
        detail: "Use browser sign-in (default)",
        authType: "interactive" as const,
      },
      {
        label: "Client Secret",
        detail: "Use app registration credentials",
        authType: "clientSecret" as const,
      },
    ],
    { placeHolder: "Select auth type for this environment" },
  );
  if (!authPick) {
    return;
  }

  const normalizedName = name.trim();
  const normalizedUrl = url.trim().replace(/\/+$/, "");
  const environment: NormalizedEnvironmentConfig = {
    name: normalizedName,
    url: normalizedUrl,
    resource: resource?.trim() || undefined,
    authType: authPick.authType,
    createMissingComponents: false,
    userAgentEnabled: false,
  };

  const existingIndex = findEnvironmentIndex(current, environment);
  const nextEnvironments = [...current.environments];
  let action = "added";
  if (existingIndex >= 0) {
    const existing = nextEnvironments[existingIndex];
    nextEnvironments[existingIndex] = {
      ...existing,
      ...environment,
      createMissingComponents: existing.createMissingComponents ?? false,
      userAgentEnabled: existing.userAgentEnabled ?? false,
    };
    action = "updated";
  } else {
    nextEnvironments.push(environment);
  }

  await configuration.saveConfiguration({
    ...current,
    environments: nextEnvironments,
  });
  pluginExplorer.refresh();
  vscode.window.showInformationMessage(`Environment ${normalizedName} ${action} in config.`);
}

export async function addSolution(ctx: CommandContext): Promise<void> {
  const { configuration, ui, connections, lastSelection, pluginExplorer } = ctx;
  const config = await configuration.loadExistingConfiguration();
  if (!config) {
    vscode.window.showErrorMessage(
      "No configuration found. Run 'Dynamics 365 Tools: Add Environment' first.",
    );
    return;
  }

  if (!config.environments.length) {
    vscode.window.showErrorMessage(
      "No environments configured. Run 'Dynamics 365 Tools: Add Environment' first.",
    );
    return;
  }

  const env = await ui.pickEnvironment(config.environments, lastSelection.getLastEnvironment(), {
    placeHolder: "Select environment to load unmanaged solutions",
  });
  if (!env) {
    return;
  }

  await lastSelection.setLastEnvironment(env.name);

  const connection = await connections.createConnection(env);
  if (!connection) {
    return;
  }
  const client = new DataverseClient(connection);

  let unmanaged: Array<{ uniqueName: string; friendlyName?: string; publisherPrefix?: string }>;
  try {
    unmanaged = await listUnmanagedSolutions(client);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to load unmanaged solutions from ${env.name}: ${String(error)}`,
    );
    return;
  }
  if (!unmanaged.length) {
    vscode.window.showInformationMessage(`No unmanaged solutions found in ${env.name}.`);
    return;
  }

  const picks = await vscode.window.showQuickPick(
    unmanaged.map((solution) => ({
      label: solution.friendlyName || solution.uniqueName,
      description:
        solution.friendlyName && solution.friendlyName !== solution.uniqueName
          ? solution.uniqueName
          : undefined,
      detail: solution.publisherPrefix
        ? `Unmanaged solution • Publisher prefix: ${solution.publisherPrefix}`
        : "Unmanaged solution",
      solution,
    })),
    {
      canPickMany: true,
      placeHolder: "Select unmanaged solutions to add to config",
    },
  );
  if (!picks || !picks.length) {
    return;
  }

  const nextSolutions = [...config.solutions];
  let added = 0;
  let updated = 0;
  let usedFallbackPrefix = 0;

  for (const pick of picks) {
    const solution = (pick as SolutionPickItem).solution;
    if (!solution) {
      continue;
    }

    const existingIndex = findSolutionIndex(nextSolutions, solution.uniqueName);
    const existing = existingIndex >= 0 ? nextSolutions[existingIndex] : undefined;
    const prefix = normalizeSolutionPrefix(
      solution.publisherPrefix || existing?.prefix || suggestPrefix(solution.uniqueName),
    );
    if (!solution.publisherPrefix) {
      usedFallbackPrefix += 1;
    }

    const entry: SolutionConfig = {
      name: solution.uniqueName,
      prefix: prefix.trim(),
    };

    if (existingIndex >= 0) {
      if (
        nextSolutions[existingIndex].name !== entry.name ||
        nextSolutions[existingIndex].prefix !== entry.prefix
      ) {
        nextSolutions[existingIndex] = entry;
        updated += 1;
      }
      continue;
    }

    nextSolutions.push(entry);
    added += 1;
  }

  if (!added && !updated) {
    vscode.window.showInformationMessage("All selected solutions are already up to date.");
    return;
  }

  nextSolutions.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  await configuration.saveConfiguration({
    ...config,
    solutions: nextSolutions,
  });
  pluginExplorer.refresh();

  const summary = [`added: ${added}`, `updated: ${updated}`];
  if (usedFallbackPrefix) {
    summary.push(`fallback prefix used: ${usedFallbackPrefix}`);
  }
  vscode.window.showInformationMessage(`Solutions saved (${summary.join(", ")}).`);
}

async function listUnmanagedSolutions(client: DataverseClient): Promise<
  Array<{
    uniqueName: string;
    friendlyName?: string;
    publisherPrefix?: string;
  }>
> {
  const collected = new Map<
    string,
    { uniqueName: string; friendlyName?: string; publisherPrefix?: string }
  >();
  let path =
    "/solutions?$select=uniquename,friendlyname&$expand=publisherid($select=customizationprefix)&$filter=ismanaged eq false&$orderby=friendlyname asc";

  while (path) {
    const response = await client.get<{
      value?: Array<{
        uniquename?: string;
        friendlyname?: string;
        publisherid?: { customizationprefix?: string };
      }>;
      "@odata.nextLink"?: string;
    }>(path);

    for (const row of response.value ?? []) {
      const uniqueName = row.uniquename?.trim();
      if (!uniqueName || isDefaultSolution(uniqueName)) {
        continue;
      }
      const key = uniqueName.toLowerCase();
      if (!collected.has(key)) {
        collected.set(key, {
          uniqueName,
          friendlyName: row.friendlyname?.trim() || undefined,
          publisherPrefix: row.publisherid?.customizationprefix?.trim() || undefined,
        });
      }
    }

    path = response["@odata.nextLink"] || "";
  }

  return Array.from(collected.values()).sort((a, b) => {
    const left = a.friendlyName || a.uniqueName;
    const right = b.friendlyName || b.uniqueName;
    return left.localeCompare(right, undefined, { sensitivity: "base" });
  });
}

function loadOrCreateEmptyConfig(
  configuration: CommandContext["configuration"],
): Promise<Dynamics365Configuration> {
  return configuration
    .loadExistingConfiguration()
    .then((config) => config ?? { environments: [], solutions: [] });
}

function validateEnvironmentName(value: string): string | undefined {
  const name = value.trim();
  if (!name) {
    return "Name is required.";
  }

  return undefined;
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

function findEnvironmentIndex(
  config: Dynamics365Configuration,
  env: NormalizedEnvironmentConfig,
): number {
  const byName = config.environments.findIndex(
    (item) => item.name.toLowerCase() === env.name.toLowerCase(),
  );
  if (byName >= 0) {
    return byName;
  }

  const normalizedUrl = env.url.toLowerCase();
  return config.environments.findIndex((item) => item.url.toLowerCase() === normalizedUrl);
}

function findSolutionIndex(solutions: SolutionConfig[], name: string): number {
  return solutions.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
}

function suggestPrefix(solutionName: string): string {
  const index = solutionName.indexOf("_");
  if (index > 0) {
    return solutionName.slice(0, index + 1);
  }
  return "new_";
}

function normalizeSolutionPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "new_";
  }
  return trimmed.endsWith("_") ? trimmed : `${trimmed}_`;
}
