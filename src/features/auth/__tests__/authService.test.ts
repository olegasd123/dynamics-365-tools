import assert from "node:assert";
import test from "node:test";
import type {
  AuthenticationPort,
  AuthenticationSession,
  AuthenticationSessionOptions,
} from "@app/ports/authentication";
import type { NotificationPort } from "@app/ports/notifications";
import { AuthService } from "../authService";

test("getAccessToken requests scope built from resource when provided", async () => {
  const authentication = new FakeAuthentication();
  authentication.session = { id: "session-id", accessToken: "token-from-session" };
  const auth = new AuthService(authentication);

  const token = await auth.getAccessToken({
    name: "dev",
    url: "https://example.crm.dynamics.com",
    resource: "https://alt.resource",
  });

  assert.strictEqual(token, "token-from-session");
  assert.deepStrictEqual(authentication.scopes, ["https://alt.resource/.default"]);
  assert.deepStrictEqual(authentication.options, { createIfNone: true });
});

test("getAccessToken can force a new interactive session", async () => {
  const authentication = new FakeAuthentication();
  authentication.session = { id: "session-id", accessToken: "token-from-session" };
  const auth = new AuthService(authentication);

  const token = await auth.getAccessToken(
    {
      name: "contoso",
      url: "https://contoso.crm.dynamics.com",
    },
    { forceNewSession: true },
  );

  assert.strictEqual(token, "token-from-session");
  assert.deepStrictEqual(authentication.options, {
    forceNewSession: true,
  });
});

test("getAccessToken surfaces errors through notifications and returns undefined", async () => {
  const notifications = createNotificationRecorder();
  const authentication = new FakeAuthentication();
  authentication.getSessionError = new Error("boom");
  const auth = new AuthService(authentication, notifications);

  const token = await auth.getAccessToken({
    name: "prod",
    url: "https://prod.crm.dynamics.com",
  });

  assert.strictEqual(token, undefined);
  assert.ok(notifications.errors[0].includes("Interactive sign-in failed for prod"));
});

test("signOut removes matching session without prompting", async () => {
  const authentication = new FakeAuthentication();
  authentication.session = { id: "session-id", accessToken: "token" };
  authentication.removeSession = async (_providerId: string, sessionId: string) => {
    authentication.removedSessionId = sessionId;
  };
  const auth = new AuthService(authentication);

  const removed = await auth.signOut({
    name: "dev",
    url: "https://example.crm.dynamics.com",
    resource: "https://alt.resource",
  });

  assert.strictEqual(removed, "removed");
  assert.deepStrictEqual(authentication.scopes, ["https://alt.resource/.default"]);
  assert.deepStrictEqual(authentication.options, {
    createIfNone: false,
    silent: true,
    clearSessionPreference: true,
  });
  assert.strictEqual(authentication.removedSessionId, "session-id");
});

test("signOut returns failed and logs error when removal fails", async () => {
  const notifications = createNotificationRecorder();
  const authentication = new FakeAuthentication();
  authentication.getSessionError = new Error("cannot fetch session");
  const auth = new AuthService(authentication, notifications);

  const removed = await auth.signOut({
    name: "prod",
    url: "https://prod.crm.dynamics.com",
  });

  assert.strictEqual(removed, "failed");
  assert.ok(notifications.errors[0].includes("Sign-out failed for prod"));
});

test("signOut returns notFound when no session is available", async () => {
  const auth = new AuthService(new FakeAuthentication());

  const removed = await auth.signOut({
    name: "qa",
    url: "https://qa.crm.dynamics.com",
  });

  assert.strictEqual(removed, "notFound");
});

test("signOut warns when the current VS Code version cannot remove sessions", async () => {
  const notifications = createNotificationRecorder();
  const authentication = new FakeAuthentication();
  authentication.session = { id: "abc", accessToken: "token" };
  const auth = new AuthService(authentication, notifications);

  const removed = await auth.signOut({
    name: "old",
    url: "https://old.crm.dynamics.com",
  });

  assert.strictEqual(removed, "failed");
  assert.ok(notifications.warnings[0].includes("Sign-out is not supported"));
});

class FakeAuthentication implements AuthenticationPort {
  session: AuthenticationSession | undefined;
  getSessionError: unknown;
  scopes: readonly string[] = [];
  options: AuthenticationSessionOptions | undefined;
  removedSessionId: string | undefined;
  removeSession?: (providerId: string, sessionId: string) => Promise<void>;

  async getSession(
    _providerId: string,
    scopes: readonly string[],
    options: AuthenticationSessionOptions,
  ): Promise<AuthenticationSession | undefined> {
    if (this.getSessionError) {
      throw this.getSessionError;
    }
    this.scopes = scopes;
    this.options = options;
    return this.session;
  }
}

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
    async askInfo() {
      return undefined;
    },
    async askWarning() {
      return undefined;
    },
    async askError() {
      return undefined;
    },
  };
}
