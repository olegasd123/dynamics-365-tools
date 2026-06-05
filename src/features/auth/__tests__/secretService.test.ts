import assert from "node:assert";
import test from "node:test";
import { MemorySecretStore } from "../../../testSupport/fakes";
import { SecretService } from "../secretService";

test("setCredentials and getCredentials round-trip credentials", async () => {
  const secrets = new MemorySecretStore();
  const service = new SecretService(secrets);

  await service.setCredentials("dev", {
    clientId: "id",
    clientSecret: "secret",
    tenantId: "tenant",
  });

  const creds = await service.getCredentials("dev");
  assert.deepStrictEqual(creds, {
    clientId: "id",
    clientSecret: "secret",
    tenantId: "tenant",
  });
});

test("getCredentials returns undefined when stored value is invalid JSON", async () => {
  const secrets = new MemorySecretStore();
  const service = new SecretService(secrets);

  await secrets.store("dynamics365tools.env.dev.credentials", "{not json");

  const creds = await service.getCredentials("dev");
  assert.strictEqual(creds, undefined);
});

test("clearCredentials removes stored secret", async () => {
  const secrets = new MemorySecretStore();
  const service = new SecretService(secrets);

  await service.setCredentials("dev", {
    clientId: "id",
    clientSecret: "secret",
  });
  await service.clearCredentials("dev");

  const creds = await service.getCredentials("dev");
  assert.strictEqual(creds, undefined);
});
