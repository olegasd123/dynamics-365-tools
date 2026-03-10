import * as vscode from "vscode";
import { CommandContext } from "./commandContext";

export interface CommandRunOptions {
  requiresWorkspace?: boolean;
  validateConfiguration?: boolean;
  validateBindings?: boolean;
  allowConcurrent?: boolean;
}

type RequiredCommandRunOptions = Required<CommandRunOptions>;

const DEFAULT_OPTIONS: RequiredCommandRunOptions = {
  requiresWorkspace: true,
  validateConfiguration: true,
  validateBindings: false,
  allowConcurrent: false,
};

const RUNNING_COMMANDS = new Set<string>();
const RELOAD_WINDOW_ACTION = "Reload Window";
const OPEN_FOLDER_ACTION = "Open Folder";
const OPEN_CONFIG_ACTION = "Open Config";
const OPEN_BINDINGS_ACTION = "Open Bindings";
const RESET_CONFIG_ACTION = "Reset Config";
const RESET_BINDINGS_ACTION = "Reset Bindings";
const RESET_CONFIRM_ACTION = "Reset";

export async function runCommandWithHealthCheck(
  ctx: CommandContext,
  commandId: string,
  handler: () => Promise<unknown> | unknown,
  options?: CommandRunOptions,
): Promise<unknown> {
  const normalizedOptions: RequiredCommandRunOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const commandLabel = toCommandLabel(commandId);

  const healthy = await runPreCommandHealthChecks(ctx, normalizedOptions);
  if (!healthy) {
    return undefined;
  }

  if (!normalizedOptions.allowConcurrent && RUNNING_COMMANDS.has(commandId)) {
    void vscode.window
      .showWarningMessage(
        `${commandLabel} is already running. Wait for completion, or reload VS Code if it looks stuck.`,
        RELOAD_WINDOW_ACTION,
      )
      .then(
        async (action) => {
          if (action === RELOAD_WINDOW_ACTION) {
            await vscode.commands.executeCommand("workbench.action.reloadWindow");
          }
        },
        () => undefined,
      );
    return undefined;
  }

  RUNNING_COMMANDS.add(commandId);
  const execution = (async () => handler())();
  vscode.window.setStatusBarMessage(
    `$(sync~spin) Dynamics 365 Tools: ${commandLabel}`,
    execution.then(
      () => undefined,
      () => undefined,
    ),
  );

  try {
    return await execution;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window
      .showErrorMessage(`${commandLabel} failed. ${message}`, RELOAD_WINDOW_ACTION)
      .then(
        async (action) => {
          if (action === RELOAD_WINDOW_ACTION) {
            await vscode.commands.executeCommand("workbench.action.reloadWindow");
          }
        },
        () => undefined,
      );
    return undefined;
  } finally {
    RUNNING_COMMANDS.delete(commandId);
  }
}

async function runPreCommandHealthChecks(
  ctx: CommandContext,
  options: RequiredCommandRunOptions,
): Promise<boolean> {
  if (options.requiresWorkspace && !vscode.workspace.workspaceFolders?.length) {
    const action = await vscode.window.showErrorMessage(
      "Open a project folder first, then run the command again.",
      OPEN_FOLDER_ACTION,
      RELOAD_WINDOW_ACTION,
    );
    if (action === OPEN_FOLDER_ACTION) {
      await vscode.commands.executeCommand("vscode.openFolder");
    } else if (action === RELOAD_WINDOW_ACTION) {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
    return false;
  }

  if (options.validateConfiguration) {
    const configValid = await validateConfiguration(ctx);
    if (!configValid) {
      return false;
    }
  }

  if (options.validateBindings) {
    const bindingsValid = await validateBindings(ctx);
    if (!bindingsValid) {
      return false;
    }
  }

  return true;
}

async function validateConfiguration(ctx: CommandContext): Promise<boolean> {
  try {
    await ctx.configuration.loadExistingConfiguration();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const action = await vscode.window.showErrorMessage(
      `Configuration check failed. Fix .vscode/dynamics365tools.config.json and run the command again. ${message}`,
      OPEN_CONFIG_ACTION,
      RESET_CONFIG_ACTION,
      RELOAD_WINDOW_ACTION,
    );

    if (action === OPEN_CONFIG_ACTION) {
      await openWorkspaceFile("dynamics365tools.config.json");
    } else if (action === RESET_CONFIG_ACTION) {
      const confirmed = await vscode.window.showWarningMessage(
        "Reset config file to an empty template? This overwrites the current file.",
        { modal: true },
        RESET_CONFIRM_ACTION,
      );
      if (confirmed === RESET_CONFIRM_ACTION) {
        await ctx.configuration.saveConfiguration({
          environments: [],
          solutions: [],
        });
        vscode.window.showInformationMessage(
          "Configuration file was reset. Add environments and solutions again if needed.",
        );
      }
    } else if (action === RELOAD_WINDOW_ACTION) {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }

    return false;
  }
}

async function validateBindings(ctx: CommandContext): Promise<boolean> {
  try {
    await ctx.configuration.loadExistingBindings();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const action = await vscode.window.showErrorMessage(
      `Bindings check failed. Fix .vscode/dynamics365tools.bindings.json and run the command again. ${message}`,
      OPEN_BINDINGS_ACTION,
      RESET_BINDINGS_ACTION,
      RELOAD_WINDOW_ACTION,
    );

    if (action === OPEN_BINDINGS_ACTION) {
      await openWorkspaceFile("dynamics365tools.bindings.json");
    } else if (action === RESET_BINDINGS_ACTION) {
      const confirmed = await vscode.window.showWarningMessage(
        "Reset bindings file to an empty template? This overwrites the current file.",
        { modal: true },
        RESET_CONFIRM_ACTION,
      );
      if (confirmed === RESET_CONFIRM_ACTION) {
        await ctx.configuration.saveBindings({ bindings: [] });
        vscode.window.showInformationMessage(
          "Bindings file was reset. Create bindings again before publishing.",
        );
      }
    } else if (action === RELOAD_WINDOW_ACTION) {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }

    return false;
  }
}

async function openWorkspaceFile(filename: string): Promise<void> {
  const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceUri) {
    return;
  }

  const fileUri = vscode.Uri.joinPath(workspaceUri, ".vscode", filename);
  await vscode.window.showTextDocument(fileUri);
}

function toCommandLabel(commandId: string): string {
  const trimmed = commandId.replace(/^dynamics365Tools\./, "");
  const sections = trimmed.split(".");
  return sections.map((section) => toWords(section)).join(" > ");
}

function toWords(value: string): string {
  const withSpaces = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}
