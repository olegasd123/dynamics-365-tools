import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { validateAssemblyIdentity, validateAssemblyUpdateTarget } from "../commands/pluginCommands";

function clearMessages(): void {
  const messages = (vscode.window as any).__messages;
  messages.info.length = 0;
  messages.warn.length = 0;
  messages.error.length = 0;
}

test("validateAssemblyIdentity blocks a different assembly name", () => {
  assert.throws(
    () =>
      validateAssemblyIdentity({ id: "id", name: "Contoso.Plugins" }, { name: "Fabrikam.Plugins" }),
    /Selected CRM assembly is "Contoso\.Plugins", but the DLL is "Fabrikam\.Plugins"/,
  );
});

test("validateAssemblyIdentity blocks a different public key token", () => {
  assert.throws(
    () =>
      validateAssemblyIdentity(
        {
          id: "id",
          name: "Contoso.Plugins",
          publicKeyToken: "abcdef1234567890",
        },
        {
          name: "Contoso.Plugins",
          publicKeyToken: "1111111111111111",
        },
      ),
    /public key token "abcdef1234567890"/,
  );
});

test("validateAssemblyIdentity blocks a different culture", () => {
  assert.throws(
    () =>
      validateAssemblyIdentity(
        { id: "id", name: "Contoso.Plugins", culture: "en-US" },
        { name: "Contoso.Plugins" },
      ),
    /uses culture "en-us", but the DLL uses "neutral"/,
  );
});

test("validateAssemblyUpdateTarget warns but allows version changes", async () => {
  clearMessages();
  const service = {
    getAssembly: async () => ({
      id: "assembly-id",
      name: "Contoso.Plugins",
      version: "1.0.0.0",
    }),
    listPluginTypes: async () => [
      { id: "type-id", name: "Plugin", typeName: "Contoso.Plugins.Plugin" },
    ],
  };
  const registration = {
    inspectAssembly: async () => ({
      assembly: { name: "Contoso.Plugins", version: "1.1.0.0" },
      plugins: [{ typeName: "Contoso.Plugins.Plugin" }],
    }),
  };

  const result = await validateAssemblyUpdateTarget({
    assemblyId: "assembly-id",
    assemblyUri: vscode.Uri.file("/workspace/Contoso.Plugins.dll"),
    pluginService: service as any,
    pluginRegistration: registration as any,
  });

  const messages = (vscode.window as any).__messages;
  assert.strictEqual(result, true);
  assert.ok(
    messages.warn.some((message: string) =>
      message.includes("version will change from 1.0.0.0 to 1.1.0.0"),
    ),
  );
});

test("validateAssemblyUpdateTarget asks before updating with no plugin type overlap", async () => {
  const originalShowWarningMessage = vscode.window.showWarningMessage;
  let warning = "";
  (vscode.window as any).showWarningMessage = async (message: string) => {
    warning = message;
    return "Update Anyway";
  };

  const service = {
    getAssembly: async () => ({ id: "assembly-id", name: "Contoso.Plugins" }),
    listPluginTypes: async () => [
      { id: "type-id", name: "Plugin", typeName: "Contoso.Plugins.Plugin" },
    ],
  };
  const registration = {
    inspectAssembly: async () => ({
      assembly: { name: "Contoso.Plugins" },
      plugins: [{ typeName: "Fabrikam.Plugins.Plugin" }],
    }),
  };

  try {
    const result = await validateAssemblyUpdateTarget({
      assemblyId: "assembly-id",
      assemblyUri: vscode.Uri.file("/workspace/Contoso.Plugins.dll"),
      pluginService: service as any,
      pluginRegistration: registration as any,
    });

    assert.strictEqual(result, true);
    assert.ok(warning.includes("no plugin types that match CRM assembly"));
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }
});
