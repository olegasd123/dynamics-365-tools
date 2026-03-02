import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { AuthorizationStore } from "../authorizationStore";

class MemoryMemento implements vscode.Memento {
  private map = new Map<string, unknown>();

  keys(): readonly string[] {
    return Array.from(this.map.keys());
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    if (!this.map.has(key)) {
      return defaultValue;
    }
    return this.map.get(key) as T;
  }

  async update(key: string, value: any): Promise<void> {
    if (value === undefined) {
      this.map.delete(key);
      return;
    }
    this.map.set(key, value);
  }
}

test("save stores and updates authorizations by URL", async () => {
  const store = new AuthorizationStore(new MemoryMemento());

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
  const store = new AuthorizationStore(new MemoryMemento());
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
    createMissingComponents: false,
    userAgentEnabled: false,
  });
});
