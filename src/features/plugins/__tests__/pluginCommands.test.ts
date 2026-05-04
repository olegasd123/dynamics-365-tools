import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import {
  AssemblyIdentityValidationError,
  extractToken,
  showPublicKeyTokenResult,
  updateAssemblyFromFileDialog,
  validateAssemblyIdentity,
  validateAssemblyUpdateTarget,
} from "../commands/pluginCommands";

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
    AssemblyIdentityValidationError,
  );
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

test("updateAssemblyFromFileDialog shows a modal error and asks for the file again on assembly mismatch", async () => {
  const originalShowOpenDialog = vscode.window.showOpenDialog;
  const originalShowErrorMessage = vscode.window.showErrorMessage;
  const originalReadFile = vscode.workspace.fs.readFile;

  const selectedFiles = [
    vscode.Uri.file("/workspace/Fabrikam.Plugins.dll"),
    vscode.Uri.file("/workspace/Contoso.Plugins.dll"),
  ];
  const modalErrors: Array<{ message: string; modal?: boolean }> = [];
  let updateCount = 0;
  let lastPath = "";

  (vscode.window as any).showOpenDialog = async () => {
    const selected = selectedFiles.shift();
    return selected ? [selected] : undefined;
  };
  (vscode.window as any).showErrorMessage = async (
    message: string,
    options?: { modal?: boolean },
  ) => {
    modalErrors.push({ message, modal: options?.modal });
    return undefined;
  };
  (vscode.workspace.fs as any).readFile = async () => Buffer.from("dll");

  const service = {
    getAssembly: async () => ({ id: "assembly-id", name: "Contoso.Plugins" }),
    listPluginTypes: async () => [],
    updateAssembly: async () => {
      updateCount += 1;
    },
  };
  const registration = {
    inspectAssembly: async (assemblyPath: string) => ({
      assembly: {
        name: assemblyPath.includes("Fabrikam") ? "Fabrikam.Plugins" : "Contoso.Plugins",
      },
      plugins: [],
    }),
    syncPluginTypes: async () => ({
      created: [],
      updated: [],
      removed: [],
      skippedCreation: [],
      skippedRemoval: [],
    }),
  };

  try {
    await updateAssemblyFromFileDialog({
      assemblyId: "assembly-id",
      assemblyName: "Contoso.Plugins",
      env: { name: "Dev", url: "https://dev.crm.dynamics.com" } as any,
      manageMissingComponents: true,
      pluginService: service as any,
      pluginRegistration: registration as any,
      assemblyStatusBar: { setLastPublish: () => undefined } as any,
      lastSelection: {
        setLastAssemblyDllPath: async (_envName: string, _assemblyId: string, path: string) => {
          lastPath = path;
        },
      } as any,
    });
  } finally {
    (vscode.window as any).showOpenDialog = originalShowOpenDialog;
    (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    (vscode.workspace.fs as any).readFile = originalReadFile;
  }

  assert.strictEqual(selectedFiles.length, 0);
  assert.strictEqual(updateCount, 1);
  assert.strictEqual(lastPath, "/workspace/Contoso.Plugins.dll");
  assert.strictEqual(modalErrors.length, 1);
  assert.strictEqual(modalErrors[0].modal, true);
  assert.match(modalErrors[0].message, /Selected CRM assembly is "Contoso\.Plugins"/);
});

test("showPublicKeyTokenResult does not wait for notification selection", () => {
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  let shownMessage = "";
  (vscode.window as any).showInformationMessage = (message: string) => {
    shownMessage = message;
    return new Promise(() => {});
  };

  try {
    showPublicKeyTokenResult("Strong name key created.", "abcdef1234567890");
  } finally {
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
  }

  assert.strictEqual(shownMessage, "Strong name key created.");
});

test("showPublicKeyTokenResult copies token when action is selected", async () => {
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  (vscode.window as any).showInformationMessage = async () => "Copy token";
  (vscode.env.clipboard as any).value = "";

  try {
    showPublicKeyTokenResult("Strong name key created.", "abcdef1234567890");
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
  }

  assert.strictEqual((vscode.env.clipboard as any).value, "abcdef1234567890");
});

test("extractToken reads Mono strong name output", () => {
  const output = ["Mono StrongName - version 6.12.0.0", "Public Key Token: 7e306b4abba83daa"].join(
    "\n",
  );

  assert.strictEqual(extractToken(output), "7e306b4abba83daa");
});
