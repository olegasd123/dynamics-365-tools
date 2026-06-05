import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { LoggerPort } from "../ports/logger";
import { VsCodeNotificationService } from "../../platform/vscode/notificationService";
import { CommandContext } from "../commandContext";
import { runCommandWithHealthCheck } from "../commandRunner";

function createContext(overrides?: {
  loadExistingConfiguration?: () => Promise<unknown>;
  loadExistingBindings?: () => Promise<unknown>;
  saveConfiguration?: (value: unknown) => Promise<void>;
  saveBindings?: (value: unknown) => Promise<void>;
  logger?: LoggerPort;
}): CommandContext {
  return {
    core: {
      configuration: {
        loadExistingConfiguration: overrides?.loadExistingConfiguration ?? (async () => undefined),
        loadExistingBindings: overrides?.loadExistingBindings ?? (async () => undefined),
        saveConfiguration: overrides?.saveConfiguration ?? (async () => undefined),
        saveBindings: overrides?.saveBindings ?? (async () => undefined),
      },
      logger: overrides?.logger ?? new TestLogger(),
      notifications: new VsCodeNotificationService(),
    },
  } as unknown as CommandContext;
}

class TestLogger implements LoggerPort {
  readonly errors: Array<{ message: string; error?: unknown; metadata?: Record<string, unknown> }> =
    [];
  shown = false;

  info(): void {}

  error(message: string, error?: unknown, metadata?: Record<string, unknown>): void {
    this.errors.push({ message, error, metadata });
  }

  show(): void {
    this.shown = true;
  }
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

test("runCommandWithHealthCheck does not block on unresolved error notification", async () => {
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file("/workspace") }];
  clearMessages();
  const ctx = createContext();

  const originalShowErrorMessage = vscode.window.showErrorMessage;
  (vscode.window as any).showErrorMessage = () => new Promise(() => {});

  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error("runCommandWithHealthCheck timed out on unresolved error message")),
        1000,
      );
    });

    const result = await Promise.race([
      runCommandWithHealthCheck(ctx, "dynamics365Tools.publishResource", async () => {
        throw new Error("boom");
      }),
      timeout,
    ]);

    assert.strictEqual(result, undefined);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    (vscode.window as any).showErrorMessage = originalShowErrorMessage;
  }
});

test("runCommandWithHealthCheck logs command errors and shows details on request", async () => {
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file("/workspace") }];
  clearMessages();
  const logger = new TestLogger();
  const ctx = createContext({ logger });
  const error = new Error("Dataverse POST accounts failed");
  (error as any).correlationId = "corr-123";
  (error as any).rawBody = '{"error":{"message":"boom"}}';

  const originalShowErrorMessage = vscode.window.showErrorMessage;
  (vscode.window as any).showErrorMessage = async (message: string) => {
    (vscode.window as any).__messages.error.push(message);
    return "Show Details";
  };

  try {
    await runCommandWithHealthCheck(ctx, "dynamics365Tools.publishResource", async () => {
      throw error;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    (vscode.window as any).showErrorMessage = originalShowErrorMessage;
  }

  const messages = (vscode.window as any).__messages;
  assert.strictEqual(logger.errors.length, 1);
  assert.strictEqual(logger.errors[0].error, error);
  assert.deepStrictEqual(logger.errors[0].metadata, {
    commandId: "dynamics365Tools.publishResource",
  });
  assert.strictEqual(logger.shown, true);
  assert.ok(
    messages.error.some((msg: string) => msg.includes("See the Dynamics 365 Tools output")),
  );
  assert.ok(!messages.error.some((msg: string) => msg.includes("corr-123")));
  assert.ok(!messages.error.some((msg: string) => msg.includes("rawBody")));
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
