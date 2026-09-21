import assert from "node:assert";
import test from "node:test";
import type { InteractiveSignInOptions } from "@features/auth/authService";
import { pickEnvironmentAndAuth } from "../commandUtils";

test("pickEnvironmentAndAuth allows sign-in prompts for a user-selected environment", async () => {
  const env = {
    name: "int",
    url: "https://int.crm.dynamics.com",
    authType: "interactive" as const,
    manageMissingComponents: false,
    userAgentEnabled: false,
  };
  let receivedOptions: InteractiveSignInOptions | undefined;

  const result = await pickEnvironmentAndAuth(
    { loadConfiguration: async () => ({ environments: [env], solutions: [] }) } as never,
    { pickEnvironment: async () => env } as never,
    { getCredentials: async () => undefined } as never,
    {
      getAccessToken: async (_env: unknown, options: InteractiveSignInOptions) => {
        receivedOptions = options;
        return "access-token";
      },
    } as never,
    {
      getLastEnvironment: () => undefined,
      setLastEnvironment: async () => undefined,
    } as never,
  );

  assert.strictEqual(result?.auth.accessToken, "access-token");
  assert.deepStrictEqual(receivedOptions, { promptIfNeeded: true });
});
