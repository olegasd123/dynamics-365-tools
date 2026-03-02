import assert from "node:assert";
import test from "node:test";
import { buildDefaultEnvironmentUrl } from "../environmentUrl";

test("buildDefaultEnvironmentUrl builds crm host from environment name", () => {
  assert.strictEqual(buildDefaultEnvironmentUrl("rd-dev"), "https://rd-dev.crm.dynamics.com");
});

test("buildDefaultEnvironmentUrl normalizes invalid chars", () => {
  assert.strictEqual(
    buildDefaultEnvironmentUrl(" Contoso DEV "),
    "https://contoso-dev.crm.dynamics.com",
  );
});
