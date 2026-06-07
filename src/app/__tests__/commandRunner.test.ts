import assert from "node:assert";
import test from "node:test";
import { RecordingNotifications, RecordingWorkbench, TestLogger } from "../../testSupport/fakes";
import { CommandContext } from "../commandContext";
import { runCommandWithHealthCheck } from "../commandRunner";

function createContext(overrides?: {
  loadExistingConfiguration?: () => Promise<unknown>;
  loadExistingBindings?: () => Promise<unknown>;
  saveConfiguration?: (value: unknown) => Promise<void>;
  saveBindings?: (value: unknown) => Promise<void>;
  logger?: TestLogger;
  notifications?: RecordingNotifications;
  workbench?: RecordingWorkbench;
  hasWorkspace?: boolean;
}): CommandContext {
  const notifications = overrides?.notifications ?? new RecordingNotifications();
  const workbench = overrides?.workbench ?? new RecordingWorkbench(overrides?.hasWorkspace ?? true);

  return {
    core: {
      configuration: {
        loadExistingConfiguration: overrides?.loadExistingConfiguration ?? (async () => undefined),
        loadExistingBindings: overrides?.loadExistingBindings ?? (async () => undefined),
        saveConfiguration: overrides?.saveConfiguration ?? (async () => undefined),
        saveBindings: overrides?.saveBindings ?? (async () => undefined),
      },
      logger: overrides?.logger ?? new TestLogger(),
      notifications,
      workbench,
    },
  } as unknown as CommandContext;
}

test("runCommandWithHealthCheck blocks command when workspace is missing", async () => {
  const notifications = new RecordingNotifications();
  const ctx = createContext({ hasWorkspace: false, notifications });
  let called = false;

  await runCommandWithHealthCheck(ctx, "dynamics365Tools.publishResource", async () => {
    called = true;
  });

  assert.strictEqual(called, false);
  assert.ok(notifications.errors.some((msg) => msg.includes("Open a project folder first")));
});

test("runCommandWithHealthCheck runs command when checks pass", async () => {
  const workbench = new RecordingWorkbench(true);
  const ctx = createContext({ workbench });
  let called = false;

  await runCommandWithHealthCheck(ctx, "dynamics365Tools.publishResource", async () => {
    called = true;
  });

  assert.strictEqual(called, true);
  assert.ok(workbench.statusMessages[0].includes("Publish Resource"));
});

test("runCommandWithHealthCheck does not block on unresolved error notification", async () => {
  const notifications = new BlockingErrorNotifications();
  const ctx = createContext({ notifications });

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
  }
});

test("runCommandWithHealthCheck logs command errors and shows details on request", async () => {
  const logger = new TestLogger();
  const notifications = new RecordingNotifications();
  notifications.nextErrorAction = "Show Details";
  const ctx = createContext({ logger, notifications });
  const error = new Error("Dataverse POST accounts failed");
  (error as any).correlationId = "corr-123";
  (error as any).rawBody = '{"error":{"message":"boom"}}';

  await runCommandWithHealthCheck(ctx, "dynamics365Tools.publishResource", async () => {
    throw error;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.strictEqual(logger.errors.length, 1);
  assert.strictEqual(logger.errors[0].error, error);
  assert.deepStrictEqual(logger.errors[0].metadata, {
    commandId: "dynamics365Tools.publishResource",
  });
  assert.strictEqual(logger.shown, true);
  assert.ok(notifications.errors.some((msg) => msg.includes("See the Dynamics 365 Tools output")));
  assert.ok(!notifications.errors.some((msg) => msg.includes("corr-123")));
  assert.ok(!notifications.errors.some((msg) => msg.includes("rawBody")));
});

test("runCommandWithHealthCheck can reset invalid configuration", async () => {
  let saved: unknown;
  let called = false;
  const notifications = new RecordingNotifications();
  notifications.nextErrorAction = "Reset Config";
  notifications.nextWarningAction = "Reset";
  const ctx = createContext({
    notifications,
    loadExistingConfiguration: async () => {
      throw new Error("Invalid JSON");
    },
    saveConfiguration: async (value: unknown) => {
      saved = value;
    },
  });

  await runCommandWithHealthCheck(ctx, "dynamics365Tools.publishResource", async () => {
    called = true;
  });

  assert.strictEqual(called, false);
  assert.deepStrictEqual(saved, { environments: [], solutions: [] });
});

class BlockingErrorNotifications extends RecordingNotifications {
  async askError<T extends string>(): Promise<T | undefined> {
    return new Promise<T | undefined>(() => undefined);
  }
}
