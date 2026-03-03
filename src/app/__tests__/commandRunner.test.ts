import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { CommandContext } from "../commandContext";
import { runCommandWithHealthCheck } from "../commandRunner";

function createContext(overrides?: {
  loadExistingConfiguration?: () => Promise<unknown>;
  loadExistingBindings?: () => Promise<unknown>;
  saveConfiguration?: (value: unknown) => Promise<void>;
  saveBindings?: (value: unknown) => Promise<void>;
}): CommandContext {
  return {
    configuration: {
      loadExistingConfiguration: overrides?.loadExistingConfiguration ?? (async () => undefined),
      loadExistingBindings: overrides?.loadExistingBindings ?? (async () => undefined),
      saveConfiguration: overrides?.saveConfiguration ?? (async () => undefined),
      saveBindings: overrides?.saveBindings ?? (async () => undefined),
    },
  } as unknown as CommandContext;
}

function clearMessages(): void {
  const messages = (vscode.window as any).__messages;
  messages.info.length = 0;
  messages.warn.length = 0;
  messages.error.length = 0;
}

test("runCommandWithHealthCheck blocks command when workspace is missing", async () => {
  (vscode.workspace as any).workspaceFolders = undefined;
  clearMessages();
  const ctx = createContext();
  let called = false;

  await runCommandWithHealthCheck(ctx, "dynamics365Tools.publishResource", async () => {
    called = true;
  });

  const messages = (vscode.window as any).__messages;
  assert.strictEqual(called, false);
  assert.ok(messages.error.some((msg: string) => msg.includes("Open a project folder first")));
});

test("runCommandWithHealthCheck runs command when checks pass", async () => {
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file("/workspace") }];
  clearMessages();
  const ctx = createContext();
  let called = false;
  let statusMessage = "";

  const originalSetStatusBarMessage = (vscode.window as any).setStatusBarMessage;
  (vscode.window as any).setStatusBarMessage = (message: string) => {
    statusMessage = message;
    return { dispose: () => {} };
  };

  try {
    await runCommandWithHealthCheck(ctx, "dynamics365Tools.publishResource", async () => {
      called = true;
    });
  } finally {
    (vscode.window as any).setStatusBarMessage = originalSetStatusBarMessage;
  }

  assert.strictEqual(called, true);
  assert.ok(statusMessage.includes("Publish Resource"));
});

test("runCommandWithHealthCheck can reset invalid configuration", async () => {
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file("/workspace") }];
  clearMessages();
  let saved: unknown;
  let called = false;
  const ctx = createContext({
    loadExistingConfiguration: async () => {
      throw new Error("Invalid JSON");
    },
    saveConfiguration: async (value: unknown) => {
      saved = value;
    },
  });

  const originalShowErrorMessage = vscode.window.showErrorMessage;
  const originalShowWarningMessage = vscode.window.showWarningMessage;

  (vscode.window as any).showErrorMessage = async () => "Reset Config";
  (vscode.window as any).showWarningMessage = async () => "Reset";

  try {
    await runCommandWithHealthCheck(ctx, "dynamics365Tools.publishResource", async () => {
      called = true;
    });
  } finally {
    (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  assert.strictEqual(called, false);
  assert.deepStrictEqual(saved, { environments: [], solutions: [] });
});
