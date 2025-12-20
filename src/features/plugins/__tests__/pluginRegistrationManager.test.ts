import assert from "node:assert";
import test from "node:test";
import { PluginRegistrationManager } from "../pluginRegistrationManager";

test("syncPluginTypes creates missing plugins, updates mismatches, and deletes orphans", async () => {
  const created: any[] = [];
  const updated: any[] = [];
  const deleted: string[] = [];

  const pluginService = {
    listPluginTypes: async () => [
      { id: "existing-1", name: "Old Name", typeName: "Namespace.Class1" },
      { id: "orphan", name: "Old", typeName: "Namespace.Orphan" },
    ],
    createPluginType: async (_assemblyId: string, input: any) => {
      created.push(input);
      return "created-id";
    },
    updatePluginType: async (id: string, input: any) => {
      updated.push({ id, input });
    },
    deletePluginTypeCascade: async (id: string) => {
      deleted.push(id);
    },
  };

  const introspector = {
    discover: async () => [
      { typeName: "Namespace.Class1", name: "New Name" },
      { typeName: "Namespace.Class2", friendlyName: "Friendly Two" },
    ],
  };

  const manager = new PluginRegistrationManager(introspector as any);
  const result = await manager.syncPluginTypes({
    pluginService: pluginService as any,
    assemblyId: "assembly-id",
    assemblyPath: "/path/plugin.dll",
    solutionName: "Core",
  });

  assert.strictEqual(result.created.length, 1);
  assert.strictEqual(result.updated.length, 1);
  assert.strictEqual(result.removed.length, 1);
  assert.deepStrictEqual(result.skippedCreation, []);
  assert.deepStrictEqual(created[0], {
    name: "Namespace.Class2",
    friendlyName: "Class2",
    typeName: "Namespace.Class2",
    solutionName: "Core",
  });
  assert.deepStrictEqual(updated[0], {
    id: "existing-1",
    input: { name: "New Name", solutionName: "Core" },
  });
  assert.deepStrictEqual(deleted, ["orphan"]);
});

test("syncPluginTypes skips creation when disabled", async () => {
  const pluginService = {
    listPluginTypes: async () => [],
    createPluginType: async () => {
      throw new Error("should not create");
    },
    updatePluginType: async () => {},
    deletePluginTypeCascade: async () => {},
  };

  const introspector = {
    discover: async () => [{ typeName: "Namespace.Plugin", name: "Name" }],
  };

  const manager = new PluginRegistrationManager(introspector as any);
  const result = await manager.syncPluginTypes({
    pluginService: pluginService as any,
    assemblyId: "assembly-id",
    assemblyPath: "/path/plugin.dll",
    allowCreate: false,
  });

  assert.deepStrictEqual(result.created, []);
  assert.deepStrictEqual(result.updated, []);
  assert.deepStrictEqual(result.removed, []);
  assert.deepStrictEqual(result.skippedCreation, [{ typeName: "Namespace.Plugin", name: "Name" }]);
});
