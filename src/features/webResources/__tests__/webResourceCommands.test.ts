import assert from "node:assert";
import * as path from "node:path";
import test from "node:test";
import * as vscode from "vscode";
import type { CommandContext } from "../../../app/commandContext";
import {
  ImmediateProgress,
  MemoryWorkspaceFiles,
  RecordingNotifications,
  RecordingWorkbench,
} from "../../../testSupport/fakes";
import type { BindingEntry, Dynamics365Configuration } from "../../config/domain/models";
import { addBinding } from "../commands/bindingCommands";
import { openInCrm } from "../commands/openCommands";
import { publishResource } from "../commands/publishCommands";

function createCommandContext(overrides: {
  workspaceRoot: string;
  files: MemoryWorkspaceFiles;
  notifications?: RecordingNotifications;
  workbench?: RecordingWorkbench;
  bindings?: {
    entries?: BindingEntry[];
    added?: BindingEntry[];
  };
  publisher?: {
    calls: Array<{
      binding: BindingEntry;
      envName: string;
      targetPath: string;
    }>;
  };
  urls?: {
    calls: Array<{
      solutionName: string;
      remotePath: string;
    }>;
  };
}): CommandContext {
  const env = {
    name: "Dev",
    url: "https://dev.crm.dynamics.com",
    manageMissingComponents: false,
    userAgentEnabled: false,
  };
  const config: Dynamics365Configuration = {
    environments: [env],
    solutions: [{ name: "Core", prefix: "new_" }],
  };
  const notifications = overrides.notifications ?? new RecordingNotifications();
  const workbench = overrides.workbench ?? new RecordingWorkbench(true);
  const bindingState = overrides.bindings ?? {};
  const entries = bindingState.entries ?? [];
  const added = bindingState.added ?? [];
  const publisher = overrides.publisher ?? { calls: [] };
  const urls = overrides.urls ?? { calls: [] };

  return {
    extensionContext: {} as never,
    core: {
      configuration: {
        workspaceRoot: overrides.workspaceRoot,
        loadConfiguration: async () => config,
        resolveLocalPath: (value: string) =>
          path.isAbsolute(value) ? value : path.join(overrides.workspaceRoot, value),
        getRelativeToWorkspace: (value: string) =>
          path.relative(overrides.workspaceRoot, value).replace(/\\/g, "/"),
      },
      ui: {
        pickEnvironment: async () => env,
        promptSolution: async () => config.solutions[0],
        promptRemotePath: async (defaultValue: string) => defaultValue,
      },
      auth: {
        getAccessToken: async () => "token",
      },
      authorizations: {},
      secrets: {
        getCredentials: async () => undefined,
      },
      logger: {},
      notifications,
      output: {},
      progress: new ImmediateProgress(),
      workbench,
      files: overrides.files,
      fileDialogs: {},
      clipboard: {},
      input: {},
      lastSelection: {
        getLastEnvironment: () => undefined,
        setLastEnvironment: async () => undefined,
      },
      connections: {
        createConnection: async () => ({
          env,
          apiRoot: `${env.url}/api/data/v9.2`,
          token: "token",
        }),
        createClient: async () => undefined,
      },
      statusBar: {
        setLastPublish: () => undefined,
        getLastPublish: () => undefined,
        clear: () => undefined,
      },
      assemblyStatusBar: {},
    },
    webResource: {
      bindings: {
        getBinding: async (uri: vscode.Uri) =>
          entries.find((entry) =>
            entry.kind === "file"
              ? entry.relativeLocalPath === uri.fsPath
              : uri.fsPath === entry.relativeLocalPath ||
                uri.fsPath.startsWith(`${entry.relativeLocalPath}${path.sep}`),
          ),
        addOrUpdateBinding: async (entry: BindingEntry) => {
          added.push(entry);
        },
        listBindings: async () => ({ bindings: entries }),
      },
      publishCache: {},
      publisher: {
        publish: async (
          binding: BindingEntry,
          selectedEnv: typeof env,
          _auth: unknown,
          targetUri?: vscode.Uri,
        ) => {
          publisher.calls.push({
            binding,
            envName: selectedEnv.name,
            targetPath: targetUri?.fsPath ?? "",
          });
          return { created: 0, updated: 1, skipped: 0, failed: 0 };
        },
        logSummary: () => undefined,
      },
      urls: {
        buildClassicWebResourceUrl: async (
          _connection: unknown,
          solutionName: string,
          remotePath: string,
        ) => {
          urls.calls.push({ solutionName, remotePath });
          return `https://make.powerapps.com/resource/${encodeURIComponent(remotePath)}`;
        },
      },
    },
    plugins: {},
    ribbon: {},
    pcf: {},
    dispose: () => undefined,
  } as unknown as CommandContext;
}

test("addBinding uses files port metadata when creating a file binding", async () => {
  const workspaceRoot = "/workspace/webresources";
  const files = new MemoryWorkspaceFiles(workspaceRoot);
  const targetPath = path.join(workspaceRoot, "scripts/account.js");
  files.addFile(targetPath, "console.log('account');");
  const added: BindingEntry[] = [];
  const notifications = new RecordingNotifications();

  await addBinding(
    createCommandContext({
      workspaceRoot,
      files,
      notifications,
      bindings: { added },
    }),
    vscode.Uri.file(targetPath),
  );

  assert.deepStrictEqual(added, [
    {
      relativeLocalPath: targetPath,
      remotePath: "new_/scripts/account.js",
      solutionName: "Core",
      kind: "file",
    },
  ]);
  assert.match(notifications.infos[0], /Bound scripts\/account\.js to new_\/scripts\/account\.js/);
});

test("publishResource publishes a bound file through fake ports", async () => {
  const workspaceRoot = "/workspace/webresources";
  const files = new MemoryWorkspaceFiles(workspaceRoot);
  const targetPath = path.join(workspaceRoot, "scripts/account.js");
  files.addFile(targetPath, "console.log('account');");
  const binding: BindingEntry = {
    relativeLocalPath: targetPath,
    remotePath: "new_/scripts/account.js",
    solutionName: "Core",
    kind: "file",
  };
  const publisher = {
    calls: [] as Array<{ binding: BindingEntry; envName: string; targetPath: string }>,
  };

  await publishResource(
    createCommandContext({
      workspaceRoot,
      files,
      bindings: { entries: [binding] },
      publisher,
    }),
    vscode.Uri.file(targetPath),
  );

  assert.deepStrictEqual(publisher.calls, [
    {
      binding,
      envName: "Dev",
      targetPath,
    },
  ]);
});

test("openInCrm resolves folder binding remote path and opens through workbench port", async () => {
  const workspaceRoot = "/workspace/webresources";
  const files = new MemoryWorkspaceFiles(workspaceRoot);
  const folderPath = path.join(workspaceRoot, "scripts");
  const targetPath = path.join(folderPath, "account.js");
  files.addFile(targetPath, "console.log('account');");
  const binding: BindingEntry = {
    relativeLocalPath: folderPath,
    remotePath: "new_/scripts",
    solutionName: "Core",
    kind: "folder",
  };
  const urls = { calls: [] as Array<{ solutionName: string; remotePath: string }> };
  const workbench = new RecordingWorkbench(true);

  await openInCrm(
    createCommandContext({
      workspaceRoot,
      files,
      workbench,
      bindings: { entries: [binding] },
      urls,
    }),
    vscode.Uri.file(targetPath),
  );

  assert.deepStrictEqual(urls.calls, [
    {
      solutionName: "Core",
      remotePath: "new_/scripts/account.js",
    },
  ]);
  assert.deepStrictEqual(workbench.externalUrls, [
    "https://make.powerapps.com/resource/new_%2Fscripts%2Faccount.js",
  ]);
});
