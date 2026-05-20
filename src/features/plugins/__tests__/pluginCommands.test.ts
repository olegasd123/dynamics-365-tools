import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import {
  AssemblyIdentityValidationError,
  extractToken,
  showPublicKeyTokenResult,
  updatePluginAssembly,
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

test("updatePluginAssembly opens file dialog in the last DLL folder", async () => {
  const originalShowOpenDialog = vscode.window.showOpenDialog;
  let dialogOptions: { defaultUri?: vscode.Uri } | undefined;

  (vscode.window as any).showOpenDialog = async (options: { defaultUri?: vscode.Uri }) => {
    dialogOptions = options;
    return undefined;
  };

  const env = { name: "Dev", url: "https://dev.crm.dynamics.com" };
  const lastPath = "/workspace/bin/Debug/net462/Contoso.Plugins.dll";

  try {
    await updatePluginAssembly(
      {
        configuration: {
          loadConfiguration: async () => ({ environments: [env] }),
          workspaceRoot: "/workspace",
        },
        ui: {},
        secrets: {
          getCredentials: async () => undefined,
        },
        auth: {
          getAccessToken: async () => "token",
        },
        lastSelection: {
          setLastEnvironment: async () => undefined,
          getLastAssemblyDllPath: () => lastPath,
        },
        connections: {
          createConnection: async () => ({
            env,
            apiRoot: "https://dev.crm.dynamics.com/api/data/v9.2",
            token: "token",
          }),
        },
        pluginRegistration: {},
        pluginExplorer: {},
        assemblyStatusBar: {},
      } as any,
      {
        env,
        assembly: { id: "assembly-id", name: "Contoso.Plugins" },
      } as any,
    );
  } finally {
    (vscode.window as any).showOpenDialog = originalShowOpenDialog;
  }

  assert.strictEqual(dialogOptions?.defaultUri?.fsPath, "/workspace/bin/Debug/net462");
});

test("updateAssemblyFromFileDialog removes missing plugin types before patching assembly", async () => {
  const originalShowOpenDialog = vscode.window.showOpenDialog;
  const originalShowWarningMessage = vscode.window.showWarningMessage;
  const originalReadFile = vscode.workspace.fs.readFile;
  const calls: string[] = [];
  let warning = "";
  let warningDetail = "";

  (vscode.window as any).showOpenDialog = async () => [
    vscode.Uri.file("/workspace/Contoso.Plugins.dll"),
  ];
  (vscode.window as any).showWarningMessage = async (
    message: string,
    options?: { detail?: string },
  ) => {
    warning = message;
    warningDetail = options?.detail ?? "";
    return "Remove and Update";
  };
  (vscode.workspace.fs as any).readFile = async () => Buffer.from("dll");

  const service = {
    getAssembly: async () => ({ id: "assembly-id", name: "Contoso.Plugins" }),
    listPluginTypes: async () => [
      { id: "old-type", name: "Old", typeName: "Contoso.Plugins.Old" },
      { id: "kept-type", name: "Kept", typeName: "Contoso.Plugins.Kept" },
    ],
    deletePluginTypeCascade: async () => {
      calls.push("deletePluginTypeCascade");
    },
    updateAssembly: async () => {
      calls.push("updateAssembly");
    },
  };
  const registration = {
    inspectAssembly: async () => ({
      assembly: { name: "Contoso.Plugins" },
      plugins: [{ typeName: "Contoso.Plugins.Kept" }],
    }),
    syncPluginTypes: async () => {
      calls.push("syncPluginTypes");
      return {
        created: [],
        updated: [],
        removed: [],
        skippedCreation: [],
        skippedRemoval: [],
      };
    },
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
        setLastAssemblyDllPath: async () => undefined,
      } as any,
    });
  } finally {
    (vscode.window as any).showOpenDialog = originalShowOpenDialog;
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    (vscode.workspace.fs as any).readFile = originalReadFile;
  }

  assert.match(warning, /sync 1 plugin type change/);
  assert.match(warningDetail, /Related steps and images/);
  assert.match(warningDetail, /Removed from DLL/);
  assert.match(warningDetail, /Contoso\.Plugins\.Old/);
  assert.deepStrictEqual(calls, ["deletePluginTypeCascade", "updateAssembly", "syncPluginTypes"]);
});

test("updateAssemblyFromFileDialog cancels update when missing plugin removal is rejected", async () => {
  const originalShowOpenDialog = vscode.window.showOpenDialog;
  const originalShowWarningMessage = vscode.window.showWarningMessage;
  const originalReadFile = vscode.workspace.fs.readFile;
  const calls: string[] = [];

  (vscode.window as any).showOpenDialog = async () => [
    vscode.Uri.file("/workspace/Contoso.Plugins.dll"),
  ];
  (vscode.window as any).showWarningMessage = async () => undefined;
  (vscode.workspace.fs as any).readFile = async () => Buffer.from("dll");

  const service = {
    getAssembly: async () => ({ id: "assembly-id", name: "Contoso.Plugins" }),
    listPluginTypes: async () => [
      { id: "old-type", name: "Old", typeName: "Contoso.Plugins.Old" },
      { id: "kept-type", name: "Kept", typeName: "Contoso.Plugins.Kept" },
    ],
    deletePluginTypeCascade: async () => {
      calls.push("deletePluginTypeCascade");
    },
    updateAssembly: async () => {
      calls.push("updateAssembly");
    },
  };
  const registration = {
    inspectAssembly: async () => ({
      assembly: { name: "Contoso.Plugins" },
      plugins: [{ typeName: "Contoso.Plugins.Kept" }],
    }),
    syncPluginTypes: async () => {
      calls.push("syncPluginTypes");
      return {
        created: [],
        updated: [],
        removed: [],
        skippedCreation: [],
        skippedRemoval: [],
      };
    },
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
        setLastAssemblyDllPath: async () => undefined,
      } as any,
    });
  } finally {
    (vscode.window as any).showOpenDialog = originalShowOpenDialog;
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    (vscode.workspace.fs as any).readFile = originalReadFile;
  }

  assert.deepStrictEqual(calls, []);
});

test("updateAssemblyFromFileDialog keeps deleting missing plugin types after one delete fails", async () => {
  const originalShowOpenDialog = vscode.window.showOpenDialog;
  const originalShowWarningMessage = vscode.window.showWarningMessage;
  const originalShowErrorMessage = vscode.window.showErrorMessage;
  const originalReadFile = vscode.workspace.fs.readFile;
  const calls: string[] = [];
  let error = "";

  (vscode.window as any).showOpenDialog = async () => [
    vscode.Uri.file("/workspace/Contoso.Plugins.dll"),
  ];
  (vscode.window as any).showWarningMessage = async () => "Remove and Update";
  (vscode.window as any).showErrorMessage = async (message: string) => {
    error = message;
    return undefined;
  };
  (vscode.workspace.fs as any).readFile = async () => Buffer.from("dll");

  const service = {
    getAssembly: async () => ({ id: "assembly-id", name: "Contoso.Plugins" }),
    listPluginTypes: async () => [
      { id: "blocked-type", name: "Blocked", typeName: "Contoso.Plugins.Blocked" },
      { id: "old-type", name: "Old", typeName: "Contoso.Plugins.Old" },
      { id: "kept-type", name: "Kept", typeName: "Contoso.Plugins.Kept" },
    ],
    deletePluginTypeCascade: async (id: string) => {
      calls.push(`delete:${id}`);
      if (id === "blocked-type") {
        throw new Error("workflow dependency");
      }
    },
    updateAssembly: async () => {
      calls.push("updateAssembly");
    },
  };
  const registration = {
    inspectAssembly: async () => ({
      assembly: { name: "Contoso.Plugins" },
      plugins: [{ typeName: "Contoso.Plugins.Kept" }],
    }),
    syncPluginTypes: async () => {
      calls.push("syncPluginTypes");
      return {
        created: [],
        updated: [],
        removed: [],
        skippedCreation: [],
        skippedRemoval: [],
      };
    },
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
        setLastAssemblyDllPath: async () => undefined,
      } as any,
    });
  } finally {
    (vscode.window as any).showOpenDialog = originalShowOpenDialog;
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    (vscode.workspace.fs as any).readFile = originalReadFile;
  }

  assert.deepStrictEqual(calls, ["delete:blocked-type", "delete:old-type"]);
  assert.match(error, /Failed to update plugin assembly/);
  assert.match(error, /Assembly was not updated/);
  assert.match(error, /Contoso\.Plugins\.Blocked/);
  assert.match(error, /workflow dependency/);
});

test("updateAssemblyFromFileDialog blocks deleted plugin types when missing management is disabled", async () => {
  const originalShowOpenDialog = vscode.window.showOpenDialog;
  const originalShowErrorMessage = vscode.window.showErrorMessage;
  const originalReadFile = vscode.workspace.fs.readFile;
  const calls: string[] = [];
  let error = "";
  let errorDetail = "";

  (vscode.window as any).showOpenDialog = async () => [
    vscode.Uri.file("/workspace/Contoso.Plugins.dll"),
  ];
  (vscode.window as any).showErrorMessage = async (
    message: string,
    options?: { detail?: string },
  ) => {
    error = message;
    errorDetail = options?.detail ?? "";
    return undefined;
  };
  (vscode.workspace.fs as any).readFile = async () => Buffer.from("dll");

  const service = {
    getAssembly: async () => ({ id: "assembly-id", name: "Contoso.Plugins" }),
    listPluginTypes: async () => [
      { id: "old-type", name: "Old", typeName: "Contoso.Plugins.Old" },
      { id: "kept-type", name: "Kept", typeName: "Contoso.Plugins.Kept" },
    ],
    deletePluginTypeCascade: async () => {
      calls.push("deletePluginTypeCascade");
    },
    updateAssembly: async () => {
      calls.push("updateAssembly");
    },
  };
  const registration = {
    inspectAssembly: async () => ({
      assembly: { name: "Contoso.Plugins" },
      plugins: [{ typeName: "Contoso.Plugins.Kept" }, { typeName: "Contoso.Plugins.New" }],
    }),
    syncPluginTypes: async () => {
      calls.push("syncPluginTypes");
      return {
        created: [],
        updated: [],
        removed: [],
        skippedCreation: [],
        skippedRemoval: [],
      };
    },
  };

  try {
    await updateAssemblyFromFileDialog({
      assemblyId: "assembly-id",
      assemblyName: "Contoso.Plugins",
      env: { name: "Prod", url: "https://prod.crm.dynamics.com" } as any,
      manageMissingComponents: false,
      pluginService: service as any,
      pluginRegistration: registration as any,
      assemblyStatusBar: { setLastPublish: () => undefined } as any,
      lastSelection: {
        setLastAssemblyDllPath: async () => undefined,
      } as any,
    });
  } finally {
    (vscode.window as any).showOpenDialog = originalShowOpenDialog;
    (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    (vscode.workspace.fs as any).readFile = originalReadFile;
  }

  assert.match(error, /cannot be updated/);
  assert.match(error, /manageMissingComponents is false/);
  assert.match(errorDetail, /Removed from DLL/);
  assert.match(errorDetail, /Contoso\.Plugins\.Old/);
  assert.match(errorDetail, /New in DLL/);
  assert.match(errorDetail, /Contoso\.Plugins\.New/);
  assert.deepStrictEqual(calls, []);
});

test("updateAssemblyFromFileDialog warns and skips new plugin creation when missing management is disabled", async () => {
  const originalShowOpenDialog = vscode.window.showOpenDialog;
  const originalShowWarningMessage = vscode.window.showWarningMessage;
  const originalReadFile = vscode.workspace.fs.readFile;
  const calls: string[] = [];
  let warning = "";
  let warningDetail = "";

  (vscode.window as any).showOpenDialog = async () => [
    vscode.Uri.file("/workspace/Contoso.Plugins.dll"),
  ];
  (vscode.window as any).showWarningMessage = async (
    message: string,
    options?: { detail?: string },
  ) => {
    warning = message;
    warningDetail = options?.detail ?? "";
    return "Update Assembly";
  };
  (vscode.workspace.fs as any).readFile = async () => Buffer.from("dll");

  const service = {
    getAssembly: async () => ({ id: "assembly-id", name: "Contoso.Plugins" }),
    listPluginTypes: async () => [
      { id: "kept-type", name: "Kept", typeName: "Contoso.Plugins.Kept" },
    ],
    updateAssembly: async () => {
      calls.push("updateAssembly");
    },
  };
  const registration = {
    inspectAssembly: async () => ({
      assembly: { name: "Contoso.Plugins" },
      plugins: [{ typeName: "Contoso.Plugins.Kept" }, { typeName: "Contoso.Plugins.New" }],
    }),
    syncPluginTypes: async () => {
      calls.push("syncPluginTypes");
      return {
        created: [],
        updated: [],
        removed: [],
        skippedCreation: [{ typeName: "Contoso.Plugins.New" }],
        skippedRemoval: [],
      };
    },
  };

  try {
    await updateAssemblyFromFileDialog({
      assemblyId: "assembly-id",
      assemblyName: "Contoso.Plugins",
      env: { name: "Prod", url: "https://prod.crm.dynamics.com" } as any,
      manageMissingComponents: false,
      pluginService: service as any,
      pluginRegistration: registration as any,
      assemblyStatusBar: { setLastPublish: () => undefined } as any,
      lastSelection: {
        setLastAssemblyDllPath: async () => undefined,
      } as any,
    });
  } finally {
    (vscode.window as any).showOpenDialog = originalShowOpenDialog;
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    (vscode.workspace.fs as any).readFile = originalReadFile;
  }

  assert.match(warning, /without creating 1 new plugin type/);
  assert.match(warningDetail, /New plugin types will not be created/);
  assert.match(warningDetail, /Contoso\.Plugins\.New/);
  assert.deepStrictEqual(calls, ["updateAssembly", "syncPluginTypes"]);
});

test("updateAssemblyFromFileDialog asks before creating new plugin types when missing management is enabled", async () => {
  const originalShowOpenDialog = vscode.window.showOpenDialog;
  const originalShowWarningMessage = vscode.window.showWarningMessage;
  const originalReadFile = vscode.workspace.fs.readFile;
  const calls: string[] = [];
  let warning = "";
  let warningDetail = "";

  (vscode.window as any).showOpenDialog = async () => [
    vscode.Uri.file("/workspace/Contoso.Plugins.dll"),
  ];
  (vscode.window as any).showWarningMessage = async (
    message: string,
    options?: { detail?: string },
  ) => {
    warning = message;
    warningDetail = options?.detail ?? "";
    return "Update Assembly";
  };
  (vscode.workspace.fs as any).readFile = async () => Buffer.from("dll");

  const service = {
    getAssembly: async () => ({ id: "assembly-id", name: "Contoso.Plugins" }),
    listPluginTypes: async () => [
      { id: "kept-type", name: "Kept", typeName: "Contoso.Plugins.Kept" },
    ],
    updateAssembly: async () => {
      calls.push("updateAssembly");
    },
  };
  const registration = {
    inspectAssembly: async () => ({
      assembly: { name: "Contoso.Plugins" },
      plugins: [{ typeName: "Contoso.Plugins.Kept" }, { typeName: "Contoso.Plugins.New" }],
    }),
    syncPluginTypes: async () => {
      calls.push("syncPluginTypes");
      return {
        created: [{ id: "new-type", name: "New", typeName: "Contoso.Plugins.New" }],
        updated: [],
        removed: [],
        skippedCreation: [],
        skippedRemoval: [],
      };
    },
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
        setLastAssemblyDllPath: async () => undefined,
      } as any,
    });
  } finally {
    (vscode.window as any).showOpenDialog = originalShowOpenDialog;
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    (vscode.workspace.fs as any).readFile = originalReadFile;
  }

  assert.match(warning, /sync 1 plugin type change/);
  assert.match(warningDetail, /New in DLL/);
  assert.match(warningDetail, /Contoso\.Plugins\.New/);
  assert.deepStrictEqual(calls, ["updateAssembly", "syncPluginTypes"]);
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
