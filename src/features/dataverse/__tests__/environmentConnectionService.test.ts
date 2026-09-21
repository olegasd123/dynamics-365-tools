import assert from "node:assert";
import test from "node:test";
import type { InteractiveSignInOptions } from "@features/auth/authService";
import { RecordingNotifications } from "../../../testSupport/fakes";
import { EnvironmentConnectionService } from "../environmentConnectionService";

test("createConnection can sign in to the exact environment from the credentials message", async () => {
  const notifications = new RecordingNotifications();
  notifications.nextErrorAction = "Sign In";
  const accessRequests: Array<InteractiveSignInOptions | undefined> = [];
  const auth = {
    getAccessToken: async (_env: unknown, options?: InteractiveSignInOptions) => {
      accessRequests.push(options);
      return options?.promptIfNeeded ? "int-token" : undefined;
    },
  };
  const service = new EnvironmentConnectionService(
    auth as never,
    { getCredentials: async () => undefined } as never,
    notifications,
  );

  const connection = await service.createConnection({
    name: "synergie-int",
    url: "https://synergieint.crm4.dynamics.com",
    authType: "interactive",
  });

  assert.strictEqual(connection?.token, "int-token");
  assert.deepStrictEqual(accessRequests, [undefined, { promptIfNeeded: true }]);
  assert.deepStrictEqual(notifications.errorPrompts, [
    {
      message:
        "No credentials available for synergie-int. Sign in to this environment to continue.",
      actions: ["Sign In"],
      options: undefined,
    },
  ]);
});
