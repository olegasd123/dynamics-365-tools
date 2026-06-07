import assert from "node:assert";
import test from "node:test";
import { MemoryStateStore } from "../../../testSupport/fakes";
import { AuthorizationStore } from "../authorizationStore";

test("save stores and updates authorizations by URL", async () => {
  const store = new AuthorizationStore(new MemoryStateStore());

  await store.save({
    name: "dev",
    url: "https://contoso.crm.dynamics.com/",
    authType: "interactive",
  });
  await store.save({
    name: "dev-updated",
    url: "https://contoso.crm.dynamics.com",
    authType: "clientSecret",
  });

  const items = store.list();
  assert.strictEqual(items.length, 1);
  assert.deepStrictEqual(items[0], {
    name: "dev-updated",
    url: "https://contoso.crm.dynamics.com",
    resource: undefined,
    authType: "clientSecret",
  });
});

test("toEnvironment applies fallback auth type", () => {
  const store = new AuthorizationStore(new MemoryStateStore());
  const env = store.toEnvironment(
    {
      name: "test",
      url: "https://fabrikam.crm.dynamics.com",
    },
    "interactive",
  );

  assert.deepStrictEqual(env, {
    name: "test",
    url: "https://fabrikam.crm.dynamics.com",
    resource: undefined,
    authType: "interactive",
    manageMissingComponents: false,
    userAgentEnabled: false,
  });
});
