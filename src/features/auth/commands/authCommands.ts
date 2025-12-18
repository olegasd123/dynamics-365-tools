import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";

export async function setEnvironmentCredentials(ctx: CommandContext): Promise<void> {
  const { configuration, ui, secrets } = ctx;
  const config = await configuration.loadConfiguration();
  const env = await ui.pickEnvironment(config.environments);
  if (!env) {
    return;
  }

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
  vscode.window.showInformationMessage(`Credentials saved securely for environment ${env.name}.`);
}

export async function signInInteractive(ctx: CommandContext): Promise<void> {
  const { configuration, ui, auth, lastSelection } = ctx;
  const config = await configuration.loadConfiguration();
  const env = await ui.pickEnvironment(config.environments, lastSelection.getLastEnvironment());
  if (!env) {
    return;
  }

  await lastSelection.setLastEnvironment(env.name);

  const token = await auth.getAccessToken(env);
  if (token) {
    vscode.window.showInformationMessage(`Signed in interactively for ${env.name}.`);
  }
}

export async function signOut(ctx: CommandContext): Promise<void> {
  const { configuration, ui, auth, secrets, lastSelection } = ctx;
  const config = await configuration.loadConfiguration();
  const env = await ui.pickEnvironment(config.environments, lastSelection.getLastEnvironment());
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
