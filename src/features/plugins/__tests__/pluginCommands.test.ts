import assert from "node:assert";
import test from "node:test";
import {
  ImmediateProgress,
  MemoryWorkspaceFiles,
  RecordingClipboard,
  RecordingFileDialogs,
  RecordingNotifications,
  RecordingTextInput,
} from "../../../testSupport/fakes";
import type { NotificationPort } from "../../../app/ports/notifications";
import { DataverseClient } from "../../dataverse/dataverseClient";
import {
  AssemblyIdentityValidationError,
  extractToken,
  showPublicKeyTokenResult,
  updatePluginAssembly,
  updateAssemblyFromFileDialog,
  validateAssemblyIdentity,
  validateAssemblyUpdateTarget,
} from "../commands/pluginCommands";

function createNotifications(): RecordingNotifications {
  return new RecordingNotifications();
}

function createPluginFiles(fsPaths = ["/workspace/Contoso.Plugins.dll"]): MemoryWorkspaceFiles {
  const files = new MemoryWorkspaceFiles("/workspace");
  for (const fsPath of fsPaths) {
    files.addFile(fsPath, "dll");
  }
  return files;
}

function legacyContext<T extends Record<string, any>>(ctx: T): T {
  return {
    ...ctx,
    core: {
      ...(ctx.core ?? {}),
      configuration: ctx.configuration,
      ui: ctx.ui,
      auth: ctx.auth,
      secrets: ctx.secrets,
      notifications: ctx.notifications,
      fileDialogs: ctx.fileDialogs,
      files: ctx.files,
      input: ctx.input,
      progress: ctx.progress,
      clipboard: ctx.clipboard,
      lastSelection: ctx.lastSelection,
      connections: ctx.connections,
      assemblyStatusBar: ctx.assemblyStatusBar,
    },
    plugins: {
      ...(ctx.plugins ?? {}),
      explorer: ctx.pluginExplorer,
      registration: ctx.pluginRegistration,
    },
  };
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
  const notifications = new RecordingNotifications();
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
    assemblyUri: { fsPath: "/workspace/Contoso.Plugins.dll" },
    pluginService: service as any,
    pluginRegistration: registration as any,
    notifications,
  });

  assert.strictEqual(result, true);
  assert.ok(
    notifications.warnings.some((message) =>
      message.includes("version will change from 1.0.0.0 to 1.1.0.0"),
    ),
  );
});

test("updateAssemblyFromFileDialog shows a modal error and asks for the file again on assembly mismatch", async () => {
  const fileDialogs = new RecordingFileDialogs();
  fileDialogs.nextOpenSelections = [
    ["/workspace/Fabrikam.Plugins.dll"],
    ["/workspace/Contoso.Plugins.dll"],
  ];
  const notifications = createNotifications();
  const files = createPluginFiles([
    "/workspace/Fabrikam.Plugins.dll",
    "/workspace/Contoso.Plugins.dll",
  ]);
  let updateCount = 0;
  let lastPath = "";

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

  await updateAssemblyFromFileDialog({
    assemblyId: "assembly-id",
    assemblyName: "Contoso.Plugins",
    env: { name: "Dev", url: "https://dev.crm.dynamics.com" } as any,
    manageMissingComponents: true,
    pluginService: service as any,
    pluginRegistration: registration as any,
    notifications,
    files,
    fileDialogs,
    progress: new ImmediateProgress(),
    assemblyStatusBar: { setLastPublish: () => undefined } as any,
    lastSelection: {
      setLastAssemblyDllPath: async (_envName: string, _assemblyId: string, path: string) => {
        lastPath = path;
      },
    } as any,
  });

  assert.strictEqual(fileDialogs.nextOpenSelections.length, 0);
  assert.strictEqual(updateCount, 1);
  assert.strictEqual(lastPath, "/workspace/Contoso.Plugins.dll");
  assert.strictEqual(notifications.errorPrompts.length, 1);
  assert.strictEqual(notifications.errorPrompts[0].options?.modal, true);
  assert.match(
    notifications.errorPrompts[0].message,
    /Selected CRM assembly is "Contoso\.Plugins"/,
  );
});

test("updatePluginAssembly opens file dialog in the last DLL folder", async () => {
  const fileDialogs = new RecordingFileDialogs();
  const env = { name: "Dev", url: "https://dev.crm.dynamics.com" };
  const lastPath = "/workspace/bin/Debug/net462/Contoso.Plugins.dll";

  await updatePluginAssembly(
    legacyContext({
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
        createClient: async () =>
          new DataverseClient({
            env,
            apiRoot: "https://dev.crm.dynamics.com/api/data/v9.2",
            token: "token",
          }),
      },
      pluginRegistration: {},
      pluginExplorer: {},
      assemblyStatusBar: {},
      fileDialogs,
      progress: new ImmediateProgress(),
    } as any),
    {
      env,
      assembly: { id: "assembly-id", name: "Contoso.Plugins" },
    } as any,
  );

  assert.strictEqual(fileDialogs.openDialogOptions[0]?.defaultPath, "/workspace/bin/Debug/net462");
});

test("updatePluginAssembly selects assembly through input port", async () => {
  const fileDialogs = new RecordingFileDialogs();
  fileDialogs.nextOpenSelections = [undefined];
  const input = new RecordingTextInput();
  const env = { name: "Dev", url: "https://dev.crm.dynamics.com" };
  const assemblyPick = {
    label: "Contoso.Plugins",
    description: "1.0.0.0",
    assembly: { id: "assembly-id", name: "Contoso.Plugins" },
  };
  input.nextQuickPickValues = [assemblyPick];

  await updatePluginAssembly(
    legacyContext({
      configuration: {
        loadConfiguration: async () => ({ environments: [env] }),
        workspaceRoot: "/workspace",
      },
      ui: {
        pickEnvironment: async () => env,
      },
      secrets: {
        getCredentials: async () => undefined,
      },
      auth: {
        getAccessToken: async () => "token",
      },
      lastSelection: {
        getLastEnvironment: () => undefined,
        setLastEnvironment: async () => undefined,
        getLastAssemblyDllPath: () => undefined,
      },
      connections: {
        createClient: async () =>
          ({
            get: async () => ({
              value: [
                {
                  pluginassemblyid: "assembly-id",
                  name: "Contoso.Plugins",
                  version: "1.0.0.0",
                },
              ],
            }),
          }) as any,
      },
      pluginRegistration: {},
      pluginExplorer: {},
      assemblyStatusBar: {},
      notifications: createNotifications(),
      files: createPluginFiles(),
      fileDialogs,
      input,
      progress: new ImmediateProgress(),
    } as any),
  );

  assert.strictEqual(input.quickPicks[0].options?.placeHolder, "Select plugin assembly to update");
  assert.strictEqual(fileDialogs.openDialogOptions[0]?.defaultPath, "/workspace");
});

test("updateAssemblyFromFileDialog removes missing plugin types before patching assembly", async () => {
  const fileDialogs = new RecordingFileDialogs();
  fileDialogs.nextOpenSelections = [["/workspace/Contoso.Plugins.dll"]];
  const notifications = createNotifications();
  notifications.nextWarningAction = "Remove and Update";
  const files = createPluginFiles();
  const calls: string[] = [];

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

  await updateAssemblyFromFileDialog({
    assemblyId: "assembly-id",
    assemblyName: "Contoso.Plugins",
    env: { name: "Dev", url: "https://dev.crm.dynamics.com" } as any,
    manageMissingComponents: true,
    pluginService: service as any,
    pluginRegistration: registration as any,
    notifications,
    files,
    fileDialogs,
    progress: new ImmediateProgress(),
    assemblyStatusBar: { setLastPublish: () => undefined } as any,
    lastSelection: {
      setLastAssemblyDllPath: async () => undefined,
    } as any,
  });

  assert.match(notifications.warningPrompts[0].message, /sync 1 plugin type change/);
  assert.match(notifications.warningPrompts[0].options?.detail ?? "", /Related steps and images/);
  assert.match(notifications.warningPrompts[0].options?.detail ?? "", /Removed from DLL/);
  assert.match(notifications.warningPrompts[0].options?.detail ?? "", /Contoso\.Plugins\.Old/);
  assert.deepStrictEqual(calls, ["deletePluginTypeCascade", "updateAssembly", "syncPluginTypes"]);
});

test("updateAssemblyFromFileDialog cancels update when missing plugin removal is rejected", async () => {
  const fileDialogs = new RecordingFileDialogs();
  fileDialogs.nextOpenSelections = [["/workspace/Contoso.Plugins.dll"]];
  const notifications = createNotifications();
  const files = createPluginFiles();
  const calls: string[] = [];

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

  await updateAssemblyFromFileDialog({
    assemblyId: "assembly-id",
    assemblyName: "Contoso.Plugins",
    env: { name: "Dev", url: "https://dev.crm.dynamics.com" } as any,
    manageMissingComponents: true,
    pluginService: service as any,
    pluginRegistration: registration as any,
    notifications,
    files,
    fileDialogs,
    progress: new ImmediateProgress(),
    assemblyStatusBar: { setLastPublish: () => undefined } as any,
    lastSelection: {
      setLastAssemblyDllPath: async () => undefined,
    } as any,
  });

  assert.deepStrictEqual(calls, []);
});

test("updateAssemblyFromFileDialog keeps deleting missing plugin types after one delete fails", async () => {
  const fileDialogs = new RecordingFileDialogs();
  fileDialogs.nextOpenSelections = [["/workspace/Contoso.Plugins.dll"]];
  const notifications = createNotifications();
  notifications.nextWarningAction = "Remove and Update";
  const files = createPluginFiles();
  const calls: string[] = [];

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

  await updateAssemblyFromFileDialog({
    assemblyId: "assembly-id",
    assemblyName: "Contoso.Plugins",
    env: { name: "Dev", url: "https://dev.crm.dynamics.com" } as any,
    manageMissingComponents: true,
    pluginService: service as any,
    pluginRegistration: registration as any,
    notifications,
    files,
    fileDialogs,
    progress: new ImmediateProgress(),
    assemblyStatusBar: { setLastPublish: () => undefined } as any,
    lastSelection: {
      setLastAssemblyDllPath: async () => undefined,
    } as any,
  });

  assert.deepStrictEqual(calls, ["delete:blocked-type", "delete:old-type"]);
  const error = notifications.errors[0] ?? "";
  assert.match(error, /Failed to update plugin assembly/);
  assert.match(error, /Assembly was not updated/);
  assert.match(error, /Contoso\.Plugins\.Blocked/);
  assert.match(error, /workflow dependency/);
});

test("updateAssemblyFromFileDialog blocks deleted plugin types when missing management is disabled", async () => {
  const fileDialogs = new RecordingFileDialogs();
  fileDialogs.nextOpenSelections = [["/workspace/Contoso.Plugins.dll"]];
  const notifications = createNotifications();
  const files = createPluginFiles();
  const calls: string[] = [];

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

  await updateAssemblyFromFileDialog({
    assemblyId: "assembly-id",
    assemblyName: "Contoso.Plugins",
    env: { name: "Prod", url: "https://prod.crm.dynamics.com" } as any,
    manageMissingComponents: false,
    pluginService: service as any,
    pluginRegistration: registration as any,
    notifications,
    files,
    fileDialogs,
    progress: new ImmediateProgress(),
    assemblyStatusBar: { setLastPublish: () => undefined } as any,
    lastSelection: {
      setLastAssemblyDllPath: async () => undefined,
    } as any,
  });

  assert.match(notifications.errorPrompts[0].message, /cannot be updated/);
  assert.match(notifications.errorPrompts[0].message, /manageMissingComponents is false/);
  assert.match(notifications.errorPrompts[0].options?.detail ?? "", /Removed from DLL/);
  assert.match(notifications.errorPrompts[0].options?.detail ?? "", /Contoso\.Plugins\.Old/);
  assert.match(notifications.errorPrompts[0].options?.detail ?? "", /New in DLL/);
  assert.match(notifications.errorPrompts[0].options?.detail ?? "", /Contoso\.Plugins\.New/);
  assert.deepStrictEqual(calls, []);
});

test("updateAssemblyFromFileDialog warns and skips new plugin creation when missing management is disabled", async () => {
  const fileDialogs = new RecordingFileDialogs();
  fileDialogs.nextOpenSelections = [["/workspace/Contoso.Plugins.dll"]];
  const notifications = createNotifications();
  notifications.nextWarningAction = "Update Assembly";
  const files = createPluginFiles();
  const calls: string[] = [];

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

  await updateAssemblyFromFileDialog({
    assemblyId: "assembly-id",
    assemblyName: "Contoso.Plugins",
    env: { name: "Prod", url: "https://prod.crm.dynamics.com" } as any,
    manageMissingComponents: false,
    pluginService: service as any,
    pluginRegistration: registration as any,
    notifications,
    files,
    fileDialogs,
    progress: new ImmediateProgress(),
    assemblyStatusBar: { setLastPublish: () => undefined } as any,
    lastSelection: {
      setLastAssemblyDllPath: async () => undefined,
    } as any,
  });

  assert.match(notifications.warningPrompts[0].message, /without creating 1 new plugin type/);
  assert.match(
    notifications.warningPrompts[0].options?.detail ?? "",
    /New plugin types will not be created/,
  );
  assert.match(notifications.warningPrompts[0].options?.detail ?? "", /Contoso\.Plugins\.New/);
  assert.deepStrictEqual(calls, ["updateAssembly", "syncPluginTypes"]);
});

test("updateAssemblyFromFileDialog asks before creating new plugin types when missing management is enabled", async () => {
  const fileDialogs = new RecordingFileDialogs();
  fileDialogs.nextOpenSelections = [["/workspace/Contoso.Plugins.dll"]];
  const notifications = createNotifications();
  notifications.nextWarningAction = "Update Assembly";
  const files = createPluginFiles();
  const calls: string[] = [];

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

  await updateAssemblyFromFileDialog({
    assemblyId: "assembly-id",
    assemblyName: "Contoso.Plugins",
    env: { name: "Dev", url: "https://dev.crm.dynamics.com" } as any,
    manageMissingComponents: true,
    pluginService: service as any,
    pluginRegistration: registration as any,
    notifications,
    files,
    fileDialogs,
    progress: new ImmediateProgress(),
    assemblyStatusBar: { setLastPublish: () => undefined } as any,
    lastSelection: {
      setLastAssemblyDllPath: async () => undefined,
    } as any,
  });

  assert.match(notifications.warningPrompts[0].message, /sync 1 plugin type change/);
  assert.match(notifications.warningPrompts[0].options?.detail ?? "", /New in DLL/);
  assert.match(notifications.warningPrompts[0].options?.detail ?? "", /Contoso\.Plugins\.New/);
  assert.deepStrictEqual(calls, ["updateAssembly", "syncPluginTypes"]);
});

test("showPublicKeyTokenResult does not wait for notification selection", () => {
  let shownMessage = "";
  const notifications = {
    info: async () => undefined,
    warning: async () => undefined,
    error: async () => undefined,
    askInfo: (message: string) => {
      shownMessage = message;
      return new Promise(() => {});
    },
    askWarning: async () => undefined,
    askError: async () => undefined,
  } as NotificationPort;

  showPublicKeyTokenResult(
    notifications,
    new RecordingClipboard(),
    "Strong name key created.",
    "abcdef1234567890",
  );

  assert.strictEqual(shownMessage, "Strong name key created.");
});

test("showPublicKeyTokenResult copies token when action is selected", async () => {
  const notifications = new RecordingNotifications();
  notifications.nextInfoAction = "Copy token";
  const clipboard = new RecordingClipboard();

  showPublicKeyTokenResult(
    notifications,
    clipboard,
    "Strong name key created.",
    "abcdef1234567890",
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepStrictEqual(clipboard.values, ["abcdef1234567890"]);
});

test("extractToken reads Mono strong name output", () => {
  const output = ["Mono StrongName - version 6.12.0.0", "Public Key Token: 7e306b4abba83daa"].join(
    "\n",
  );

  assert.strictEqual(extractToken(output), "7e306b4abba83daa");
});
