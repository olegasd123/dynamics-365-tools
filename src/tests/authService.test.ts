import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { AuthService } from "../services/authService";

test("getAccessToken requests scope built from resource when provided", async () => {
  const auth = new AuthService();
  let capturedScopes: string[] = [];
  (vscode.authentication as any).getSession = async (_providerId: string, scopes: string[]) => {
    capturedScopes = scopes;
    return { accessToken: "token-from-session" };
  };

  const token = await auth.getAccessToken({
    name: "dev",
    url: "https://example.crm.dynamics.com",
    resource: "https://alt.resource",
  });

  assert.strictEqual(token, "token-from-session");
  assert.deepStrictEqual(capturedScopes, ["https://alt.resource/.default"]);
});

test("getAccessToken surfaces errors as window error and returns undefined", async () => {
  const auth = new AuthService();
  (vscode.authentication as any).getSession = async () => {
    throw new Error("boom");
  };

  const messages = (vscode.window as any).__messages;
  messages.error.length = 0;

  const token = await auth.getAccessToken({
    name: "prod",
    url: "https://prod.crm.dynamics.com",
  });

  assert.strictEqual(token, undefined);
  assert.ok(messages.error[0].includes("Interactive sign-in failed for prod"));
});
