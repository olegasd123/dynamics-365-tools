import assert from "node:assert";
import test from "node:test";
import type {
  AuthenticationPort,
  AuthenticationSession,
  AuthenticationSessionOptions,
} from "@app/ports/authentication";
import type { NotificationPort } from "@app/ports/notifications";
import { AuthService } from "../authService";

test("getAccessToken silently reuses the session for normal CRM actions", async () => {
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
  assert.deepStrictEqual(authentication.options, {
    createIfNone: false,
    silent: true,
  });
});

test("getAccessToken prompts for a user action and caches a valid token", async () => {
  const authentication = new FakeAuthentication();
  const accessToken = createAccessToken(Date.now() + 3_600_000);
  authentication.sessionResults.push(undefined, {
    id: "new-session-id",
    accessToken,
  });
  const auth = new AuthService(authentication);
  const env = {
    name: "dev",
    url: "https://example.crm.dynamics.com",
  };

  assert.strictEqual(await auth.getAccessToken(env, { promptIfNeeded: true }), accessToken);
  assert.strictEqual(await auth.getAccessToken(env), accessToken);
  assert.deepStrictEqual(
    authentication.calls.map((call) => call.options),
    [{ createIfNone: false, silent: true }, { createIfNone: true }],
  );
});

test("getAccessToken does not prompt during background access", async () => {
  const authentication = new FakeAuthentication();
  authentication.sessionResults.push(undefined, undefined);
  const auth = new AuthService(authentication);
  const env = {
    name: "dev",
    url: "https://example.crm.dynamics.com",
  };

  assert.strictEqual(await auth.getAccessToken(env), undefined);
  assert.strictEqual(await auth.getAccessToken(env), undefined);
  assert.deepStrictEqual(
    authentication.calls.map((call) => call.options),
    [
      { createIfNone: false, silent: true },
      { createIfNone: false, silent: true },
    ],
  );
});

test("getAccessToken serializes prompts for different environment scopes", async () => {
  const authentication = new ControlledPromptAuthentication();
  const auth = new AuthService(authentication);

  const firstToken = auth.getAccessToken(
    { name: "dev", url: "https://dev.crm.dynamics.com" },
    { promptIfNeeded: true },
  );
  await waitForEventLoop();
  assert.deepStrictEqual(authentication.promptedScopes, ["https://dev.crm.dynamics.com/.default"]);

  const secondToken = auth.getAccessToken(
    { name: "int", url: "https://int.crm.dynamics.com" },
    { promptIfNeeded: true },
  );
  await waitForEventLoop();
  assert.strictEqual(authentication.promptedScopes.length, 1);

  authentication.resolveNext({ id: "dev-session", accessToken: "dev-token" });
  assert.strictEqual(await firstToken, "dev-token");
  await waitForEventLoop();
  assert.deepStrictEqual(authentication.promptedScopes, [
    "https://dev.crm.dynamics.com/.default",
    "https://int.crm.dynamics.com/.default",
  ]);

  authentication.resolveNext({ id: "int-session", accessToken: "int-token" });
  assert.strictEqual(await secondToken, "int-token");
});

test("getAccessToken can prompt when an explicit sign-in needs a session", async () => {
  const authentication = new FakeAuthentication();
  authentication.session = { id: "session-id", accessToken: "token-from-session" };
  const auth = new AuthService(authentication);

  const token = await auth.getAccessToken(
    {
      name: "dev",
      url: "https://example.crm.dynamics.com",
    },
    { promptIfNeeded: true, clearSessionPreference: true },
  );

  assert.strictEqual(token, "token-from-session");
  assert.deepStrictEqual(authentication.options, {
    createIfNone: true,
    clearSessionPreference: true,
  });
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
  readonly sessionResults: Array<AuthenticationSession | undefined> = [];
  readonly calls: Array<{
    scopes: readonly string[];
    options: AuthenticationSessionOptions;
  }> = [];
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
    this.calls.push({ scopes, options });
    return this.sessionResults.length ? this.sessionResults.shift() : this.session;
  }
}

class ControlledPromptAuthentication implements AuthenticationPort {
  readonly promptedScopes: string[] = [];
  private readonly promptResolvers: Array<(session: AuthenticationSession | undefined) => void> =
    [];

  async getSession(
    _providerId: string,
    scopes: readonly string[],
    options: AuthenticationSessionOptions,
  ): Promise<AuthenticationSession | undefined> {
    if (options.silent) {
      return undefined;
    }

    this.promptedScopes.push(scopes[0]);
    return new Promise((resolve) => {
      this.promptResolvers.push(resolve);
    });
  }

  resolveNext(session: AuthenticationSession | undefined): void {
    const resolve = this.promptResolvers.shift();
    assert.ok(resolve, "Expected a pending authentication prompt");
    resolve(session);
  }
}

async function waitForEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function createAccessToken(expiresAt: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(expiresAt / 1000) }),
    "utf8",
  ).toString("base64url");
  return `header.${payload}.signature`;
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
