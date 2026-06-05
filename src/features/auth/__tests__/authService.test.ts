import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import type { NotificationPort } from "../../../app/ports/notifications";
import { AuthService } from "../authService";

test("getAccessToken requests scope built from resource when provided", async () => {
  const auth = new AuthService();
  let capturedScopes: string[] = [];
  let capturedOptions: any;
  (vscode.authentication as any).getSession = async (
    _providerId: string,
    scopes: string[],
    options: any,
  ) => {
    capturedScopes = scopes;
    capturedOptions = options;
    return { accessToken: "token-from-session" };
  };

  const token = await auth.getAccessToken({
    name: "dev",
    url: "https://example.crm.dynamics.com",
    resource: "https://alt.resource",
  });

  assert.strictEqual(token, "token-from-session");
  assert.deepStrictEqual(capturedScopes, ["https://alt.resource/.default"]);
  assert.deepStrictEqual(capturedOptions, { createIfNone: true });
});

test("getAccessToken can force a new interactive session", async () => {
  const auth = new AuthService();
  let capturedOptions: any;
  (vscode.authentication as any).getSession = async (
    _providerId: string,
    _scopes: string[],
    options: any,
  ) => {
    capturedOptions = options;
    return { accessToken: "token-from-session" };
  };

  const token = await auth.getAccessToken(
    {
      name: "contoso",
      url: "https://contoso.crm.dynamics.com",
    },
    { forceNewSession: true },
  );

  assert.strictEqual(token, "token-from-session");
  assert.deepStrictEqual(capturedOptions, {
    forceNewSession: true,
  });
});

test("getAccessToken surfaces errors through notifications and returns undefined", async () => {
  const notifications = createNotificationRecorder();
  const auth = new AuthService(notifications);
  (vscode.authentication as any).getSession = async () => {
    throw new Error("boom");
  };

  const token = await auth.getAccessToken({
    name: "prod",
    url: "https://prod.crm.dynamics.com",
  });

  assert.strictEqual(token, undefined);
  assert.ok(notifications.errors[0].includes("Interactive sign-in failed for prod"));
});

test("signOut removes matching session without prompting", async () => {
  const auth = new AuthService();
  let capturedScopes: string[] = [];
  let capturedOptions: any;
  let removedSessionId: string | undefined;

  (vscode.authentication as any).getSession = async (
    _providerId: string,
    scopes: string[],
    options: any,
  ) => {
    capturedScopes = scopes;
    capturedOptions = options;
    return { id: "session-id", accessToken: "token" };
  };
  (vscode.authentication as any).removeSession = async (_providerId: string, sessionId: string) => {
    removedSessionId = sessionId;
  };

  const removed = await auth.signOut({
    name: "dev",
    url: "https://example.crm.dynamics.com",
    resource: "https://alt.resource",
  });

  assert.strictEqual(removed, "removed");
  assert.deepStrictEqual(capturedScopes, ["https://alt.resource/.default"]);
  assert.deepStrictEqual(capturedOptions, {
    createIfNone: false,
    silent: true,
    clearSessionPreference: true,
  });
  assert.strictEqual(removedSessionId, "session-id");
});

test("signOut returns failed and logs error when removal fails", async () => {
  const notifications = createNotificationRecorder();
  const auth = new AuthService(notifications);

  (vscode.authentication as any).getSession = async () => {
    throw new Error("cannot fetch session");
  };

  const removed = await auth.signOut({
    name: "prod",
    url: "https://prod.crm.dynamics.com",
  });

  assert.strictEqual(removed, "failed");
  assert.ok(notifications.errors[0].includes("Sign-out failed for prod"));
});

test("signOut returns notFound when no session is available", async () => {
  const auth = new AuthService();
  (vscode.authentication as any).getSession = async () => undefined;
  (vscode.authentication as any).removeSession = undefined;

  const removed = await auth.signOut({
    name: "qa",
    url: "https://qa.crm.dynamics.com",
  });

  assert.strictEqual(removed, "notFound");
});

test("signOut warns when the current VS Code version cannot remove sessions", async () => {
  const notifications = createNotificationRecorder();
  const auth = new AuthService(notifications);

  (vscode.authentication as any).getSession = async () => ({ id: "abc", accessToken: "token" });
  (vscode.authentication as any).removeSession = undefined;

  const removed = await auth.signOut({
    name: "old",
    url: "https://old.crm.dynamics.com",
  });

  assert.strictEqual(removed, "failed");
  assert.ok(notifications.warnings[0].includes("Sign-out is not supported"));
});

function createNotificationRecorder(): NotificationPort & {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  return {
    errors,
    warnings,
    async info() {},
    async warning(message: string) {
      warnings.push(message);
    },
    async error(message: string) {
      errors.push(message);
    },
    async askWarning() {
      return undefined;
    },
    async askError() {
      return undefined;
    },
  };
}
