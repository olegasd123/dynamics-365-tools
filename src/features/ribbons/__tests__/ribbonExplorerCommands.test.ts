import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import * as vscode from "vscode";
import JSZip from "jszip";
import { applyRibbonPatchSequence } from "../ribbonPatchWriter";
import { createCustomButtonPatches, createDeleteNodePatch } from "../ribbonEditPatches";
import {
  editRibbonNode,
  extractJavaScriptFunctionSuggestions,
  listBoundJavaScriptLibraries,
  moveRibbonNodeDown,
  moveRibbonNodeUp,
  normalizeWebResourceUniqueName,
  openRibbonsFromSolution,
  publishRibbonToEnvironment,
} from "../commands/ribbonExplorerCommands";
import { RibbonPatch, RibbonSource } from "../models";
import { RibbonEditorState } from "../ribbonEditorState";
import { RibbonDocumentNode, RibbonItemNode } from "../ribbonExplorer";
import { RibbonRepository } from "../ribbonRepository";
import { SolutionZipService } from "../solutionZipService";
import { readRibbonDocuments } from "../ribbonXmlReader";

test("normalizes manually typed web resource names", () => {
  assert.strictEqual(
    normalizeWebResourceUniqueName("  $webresource:new_\\scripts\\account.js  "),
    "new_/scripts/account.js",
  );
  assert.strictEqual(
    normalizeWebResourceUniqueName("new_/scripts/account.js"),
    "new_/scripts/account.js",
  );
});

test("lists each bound JavaScript web resource once", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-js-pick-"));

  const picks = await listBoundJavaScriptLibraries({
    bindings: {
      listBindings: async () => ({
        bindings: [
          {
            kind: "file",
            relativeLocalPath: "src/account/form.js",
            remotePath: "new_/account/form.js",
            solutionName: "core",
          },
          {
            kind: "file",
            relativeLocalPath: "src/account/form-copy.js",
            remotePath: "new_\\account\\form.js",
            solutionName: "core",
          },
          {
            kind: "file",
            relativeLocalPath: "src/account/form-copy.js",
            remotePath: "new_/account/form-copy.js",
            solutionName: "core",
          },
        ],
      }),
    },
    configuration: {
      resolveLocalPath: (value: string) => path.join(workspaceRoot, value),
      getRelativeToWorkspace: (value: string) => path.relative(workspaceRoot, value),
    },
  } as any);

  assert.deepStrictEqual(
    picks.map((pick) => pick.uniqueName),
    ["new_/account/form-copy.js", "new_/account/form.js"],
  );
});

test("extracts full names from compiled TypeScript namespace JavaScript", () => {
  const source = `"use strict";
var Hjk;
(function (Hjk) {
    var Account;
    (function (Account) {
        var Ribbon = /** @class */ (function () {
            function Ribbon() {
            }
            Ribbon.buttonVisible = function (primaryControl, recordId, entityName) {
                return true;
            };
            Ribbon.onButtonClick = function (primaryControl, recordId, entityName) {
                Xrm.Navigation.openAlertDialog({ text: entityName });
            };
            return Ribbon;
        }());
        Account.Ribbon = Ribbon;
    })(Account = Hjk.Account || (Hjk.Account = {}));
})(Hjk || (Hjk = {}));`;

  assert.deepStrictEqual(extractJavaScriptFunctionSuggestions(source), [
    "Hjk.Account.Ribbon.buttonVisible",
    "Hjk.Account.Ribbon.onButtonClick",
  ]);
});

test("prefills saved JavaScript action values while editing", async () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <Actions>
        <JavaScriptFunction Library="$webresource:new_/account/form.js" FunctionName="onButtonClick">
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="CommandProperties" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const action = document.views[0].commandDefinitions[0].actions[0];
  const node = new RibbonItemNode(
    "JavaScript: onButtonClick",
    undefined,
    "d365RibbonJavaScriptAction",
    "symbol-method",
    [],
    [],
    { document, range: action.range },
  );
  let patches: RibbonPatch[] = [];
  let actionKindItems: vscode.QuickPickItem[] = [];
  let libraryItems: vscode.QuickPickItem[] = [];
  let parameterItems: vscode.QuickPickItem[] = [];
  let functionInputValue: string | undefined;

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: any[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Command action") {
      actionKindItems = items;
      return items.find((item) => item.label === "JavaScript function");
    }

    if (options.placeHolder === "JavaScript web resource") {
      libraryItems = items;
      return items[0];
    }

    if (options.placeHolder === "CRM parameters") {
      parameterItems = items;
      return items.filter((item) => item.picked);
    }

    return undefined;
  };
  (vscode.window as any).showInputBox = async (options: { prompt?: string; value?: string }) => {
    if (options.prompt === "JavaScript function name") {
      functionInputValue = options.value;
      return options.value;
    }

    return undefined;
  };

  try {
    await editRibbonNode(
      {
        bindings: {
          listBindings: async () => ({
            bindings: [
              {
                kind: "file",
                relativeLocalPath: "src/account/form.js",
                remotePath: "new_/account/form.js",
                solutionName: "core",
              },
            ],
          }),
        },
        configuration: {
          resolveLocalPath: (value: string) => path.join("/tmp", value),
          getRelativeToWorkspace: (value: string) => value,
        },
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any,
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  assert.strictEqual(
    actionKindItems.find((item) => item.label === "JavaScript function")?.description,
    "Current action type",
  );
  assert.strictEqual(libraryItems[0]?.label, "new_/account/form.js");
  assert.strictEqual(functionInputValue, "onButtonClick");
  assert.deepStrictEqual(
    parameterItems.filter((item) => item.picked).map((item) => item.label),
    ["PrimaryControl", "CommandProperties"],
  );

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const updatedAction = updatedDocument.views[0].commandDefinitions[0].actions[0];
  assert.strictEqual(updatedAction.kind, "JavaScriptFunction");
  assert.deepStrictEqual(
    updatedAction.kind === "JavaScriptFunction"
      ? updatedAction.parameters.map((parameter) => parameter.value)
      : [],
    ["PrimaryControl", "CommandProperties"],
  );
});

test("suggests full namespace while editing JavaScript action function", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-js-namespace-"));
  const localPath = path.join(workspaceRoot, "src/account/ribbon.js");
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(
    localPath,
    `"use strict";
var Hjk;
(function (Hjk) {
    var Account;
    (function (Account) {
        var Ribbon = /** @class */ (function () {
            function Ribbon() {
            }
            Ribbon.buttonVisible = function (primaryControl, recordId, entityName) {
                return true;
            };
            Ribbon.onButtonClick = function (primaryControl, recordId, entityName) {
                Xrm.Navigation.openAlertDialog({ text: entityName });
            };
            return Ribbon;
        }());
        Account.Ribbon = Ribbon;
    })(Account = Hjk.Account || (Hjk.Account = {}));
})(Hjk || (Hjk = {}));`,
    "utf8",
  );

  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <Actions>
        <JavaScriptFunction Library="$webresource:hjk_/account/ribbon.js" FunctionName="Ribbon.onButtonClick" />
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const action = document.views[0].commandDefinitions[0].actions[0];
  const node = new RibbonItemNode(
    "JavaScript: Ribbon.onButtonClick",
    undefined,
    "d365RibbonJavaScriptAction",
    "symbol-method",
    [],
    [],
    { document, range: action.range },
  );
  let patches: RibbonPatch[] = [];
  let functionItems: vscode.QuickPickItem[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;

  (vscode.window as any).showQuickPick = async (
    items: any[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Command action") {
      return items.find((item) => item.label === "JavaScript function");
    }

    if (options.placeHolder === "JavaScript web resource") {
      return items[0];
    }

    if (options.placeHolder === "JavaScript function name") {
      functionItems = items;
      return items[0];
    }

    if (options.placeHolder === "CRM parameters") {
      return [];
    }

    return undefined;
  };

  try {
    await editRibbonNode(
      {
        bindings: {
          listBindings: async () => ({
            bindings: [
              {
                kind: "file",
                relativeLocalPath: "src/account/ribbon.js",
                remotePath: "hjk_/account/ribbon.js",
                solutionName: "core",
              },
            ],
          }),
        },
        configuration: {
          resolveLocalPath: (value: string) => path.join(workspaceRoot, value),
          getRelativeToWorkspace: (value: string) => path.relative(workspaceRoot, value),
        },
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any,
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
  }

  assert.deepStrictEqual(
    functionItems.map((item) => item.label),
    ["Hjk.Account.Ribbon.onButtonClick", "Hjk.Account.Ribbon.buttonVisible", "Type function name"],
  );
  assert.strictEqual(functionItems[0]?.description, "Current function");

  const updated = applyRibbonPatchSequence(source, patches);
  assert.match(updated, /FunctionName="Hjk\.Account\.Ribbon\.onButtonClick"/);
});

test("offers to save a backup when opening an exported solution", async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-export-"));
  const backupPath = path.join(storageRoot, "backup.zip");
  const zip = new JSZip();
  zip.file("customizations.xml", "<ImportExportXml><RibbonDiffXml /></ImportExportXml>");
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const service = new SolutionZipService();
  let backupPromptShown = false;
  let saveDialogDefaultUri: vscode.Uri | undefined;
  let importedSource: RibbonSource | undefined;

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  const originalShowSaveDialog = vscode.window.showSaveDialog;

  (vscode.window as any).showQuickPick = async (items: any[]) => {
    if (items[0]?.sourceKind === "environment") {
      return items[0];
    }
    return items[0];
  };
  (vscode.window as any).showInformationMessage = async (message: string) => {
    if (message.startsWith("Save a backup copy")) {
      backupPromptShown = true;
      return "Save Backup";
    }
    return undefined;
  };
  (vscode.window as any).showSaveDialog = async (options: { defaultUri?: vscode.Uri }) => {
    saveDialogDefaultUri = options.defaultUri;
    return vscode.Uri.file(backupPath);
  };

  try {
    await openRibbonsFromSolution({
      extensionContext: { globalStorageUri: vscode.Uri.file(storageRoot) },
      configuration: {
        workspaceRoot: storageRoot,
        loadConfiguration: async () => ({
          environments: [{ name: "Dev", url: "https://org.crm.dynamics.com" }],
          solutions: [],
        }),
      },
      ui: {
        pickEnvironment: async (environments: unknown[]) => environments[0],
      },
      auth: {
        getAccessToken: async () => "token",
      },
      secrets: {
        getCredentials: async () => undefined,
      },
      lastSelection: {
        getLastEnvironment: () => undefined,
        setLastEnvironment: async () => undefined,
      },
      connections: {
        createConnection: async (env: unknown) => ({
          env,
          apiRoot: "https://org.crm.dynamics.com/api/data/v9.2",
          token: "token",
        }),
      },
      solutionZipService: {
        listUnmanagedSolutions: async () => [
          { uniqueName: "core", friendlyName: "Core", version: "1.0.0" },
        ],
        downloadSolutionZip: async () => buffer,
        saveBufferToZip: service.saveBufferToZip.bind(service),
        openZipBuffer: service.openZipBuffer.bind(service),
      },
      ribbonSourceLocator: {
        addImportedSource: (source: RibbonSource) => {
          importedSource = source;
        },
      },
      ribbonExplorer: {
        refresh: () => undefined,
      },
    } as any);
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    (vscode.window as any).showSaveDialog = originalShowSaveDialog;
  }

  assert.strictEqual(backupPromptShown, true);
  assert.ok(saveDialogDefaultUri?.fsPath.startsWith(storageRoot));
  assert.deepStrictEqual(await fs.readFile(backupPath), buffer);
  assert.strictEqual(importedSource?.name, "core.zip");
});

test("publishes saved ribbon XML to the selected unmanaged solution", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-publish-"));
  const filePath = path.join(workspaceRoot, "RibbonDiffXml.xml");
  await fs.writeFile(
    filePath,
    `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="d365tools.account.Form.CustomSave.CustomAction" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="d365tools.account.Form.CustomSave.Button" Command="d365tools.account.Form.CustomSave.Command" LabelText="custom save" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
</RibbonDiffXml>`,
    "utf8",
  );
  const source: RibbonSource = {
    id: `flat:${filePath}`,
    kind: "flat",
    name: "RibbonDiffXml.xml",
    rootUri: workspaceRoot,
    files: [{ fileUri: filePath, kind: "Entity", entityLogicalName: "account" }],
  };
  const state = new RibbonEditorState(new RibbonRepository());
  const [originalDocument] = await state.loadSource(source);
  const oldAction = originalDocument.views[0].customActions[0];
  state.queuePatches(originalDocument, [
    createDeleteNodePatch(originalDocument.sourceText, oldAction.range),
  ]);
  const [documentAfterDelete] = await state.loadSource(source);
  state.queuePatches(
    documentAfterDelete,
    createCustomButtonPatches(documentAfterDelete, {
      customActionId: "d365tools.account.Form.ValidateAndSave.CustomAction",
      location: "Mscrm.Form.account.MainTab.Save.Controls._children",
      buttonId: "d365tools.account.Form.ValidateAndSave.Button",
      commandId: "d365tools.account.Form.ValidateAndSave.Command",
      labelLocId: "d365tools.account.Form.ValidateAndSave.Label",
      action: { kind: "Url", address: "https://contoso.example/validate" },
      locLabel: {
        id: "d365tools.account.Form.ValidateAndSave.Label",
        languageCode: 1033,
        description: "Validate and save",
      },
    }),
  );

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowWarningMessage = vscode.window.showWarningMessage;
  let publishedSolution: string | undefined;
  let publishedXml = "";

  (vscode.window as any).showQuickPick = async (
    items: any[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Select unmanaged solution to update") {
      return items[0];
    }
    return undefined;
  };
  (vscode.window as any).showWarningMessage = async (message: string) => {
    if (message === "Save ribbon changes before publishing?") {
      return "Save and Publish";
    }
    return undefined;
  };

  try {
    await publishRibbonToEnvironment(
      {
        configuration: {
          workspaceRoot,
          loadConfiguration: async () => ({
            environments: [{ name: "Dev", url: "https://org.crm.dynamics.com" }],
            solutions: [],
          }),
        },
        ui: {
          pickEnvironment: async (environments: unknown[]) => environments[0],
        },
        auth: {
          getAccessToken: async () => "token",
        },
        secrets: {
          getCredentials: async () => undefined,
        },
        lastSelection: {
          getLastEnvironment: () => undefined,
          setLastEnvironment: async () => undefined,
        },
        connections: {
          createConnection: async (env: unknown) => ({
            env,
            apiRoot: "https://org.crm.dynamics.com/api/data/v9.2",
            token: "token",
          }),
        },
        ribbonEditorState: state,
        ribbonSourceLocator: {
          locate: async () => [source],
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
        ribbonPublishService: {
          listUnmanagedSolutions: async () => [
            {
              uniqueName: "core",
              friendlyName: "Core",
              publisherPrefix: "new",
              publisherUniqueName: "newpublisher",
            },
          ],
          publishDocuments: async (_client: unknown, documents: any[], solution: any) => {
            publishedSolution = solution.uniqueName;
            publishedXml = documents[0]?.sourceText ?? "";
            return {
              importJobId: "job",
              durationMs: 0,
              entities: ["account"],
              includesApplicationRibbon: false,
            };
          },
        },
      } as any,
      new RibbonDocumentNode(originalDocument, true),
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  assert.strictEqual(publishedSolution, "core");
  assert.doesNotMatch(publishedXml, /custom save/);
  assert.match(publishedXml, /Validate and save/);
});

test("moves ribbon nodes down without losing unequal sibling XML", async () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="short"><Actions><Url Address="https://short.example" /></Actions></CommandDefinition>
    <CommandDefinition Id="longer">
      <EnableRules>
        <EnableRule Id="new.Enabled" />
      </EnableRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:new_/scripts/account.js" FunctionName="run" />
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const [short] = document.views[0].commandDefinitions;
  const node = new RibbonItemNode(
    short.id,
    undefined,
    "d365RibbonCommandDefinition",
    "gear",
    [],
    [],
    { document, range: short.range },
  );
  let patches: RibbonPatch[] = [];
  let refreshed = false;

  await moveRibbonNodeDown(
    {
      configuration: {
        workspaceRoot: "/tmp",
      },
      ribbonSourceLocator: {
        locate: async () => [
          {
            id: "source",
            kind: "flat",
            name: "Source",
            rootUri: "/tmp",
            files: [{ fileUri: "/tmp/RibbonDiffXml.xml", kind: "Application" }],
          },
        ],
      },
      ribbonEditorState: {
        loadSource: async () => [document],
        queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
          patches = queuedPatches;
        },
      },
      ribbonExplorer: {
        refresh: () => {
          refreshed = true;
        },
      },
    } as any,
    node,
  );

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.strictEqual(refreshed, true);
  assert.deepStrictEqual(
    updatedDocument.views[0].commandDefinitions.map((command) => command.id),
    ["longer", "short"],
  );
  assert.match(updated, /<JavaScriptFunction Library="\$webresource:new_\/scripts\/account\.js"/);
  assert.match(updated, /https:\/\/short\.example/);
});

test("moves JavaScript parameters with ribbon move commands", async () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <Actions>
        <JavaScriptFunction Library="$webresource:new_/scripts/account.js" FunctionName="run">
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const action = document.views[0].commandDefinitions[0].actions[0];
  assert.strictEqual(action.kind, "JavaScriptFunction");
  const parameter = action.parameters[1];
  assert.ok(parameter.range);
  const node = new RibbonItemNode(
    `2. ${parameter.value}`,
    parameter.kind,
    "d365RibbonParameter",
    "symbol-parameter",
    [],
    [],
    { document, range: parameter.range },
  );
  let patches: RibbonPatch[] = [];

  await moveRibbonNodeUp(
    {
      configuration: {
        workspaceRoot: "/tmp",
      },
      ribbonSourceLocator: {
        locate: async () => [
          {
            id: "source",
            kind: "flat",
            name: "Source",
            rootUri: "/tmp",
            files: [{ fileUri: "/tmp/RibbonDiffXml.xml", kind: "Application" }],
          },
        ],
      },
      ribbonEditorState: {
        loadSource: async () => [document],
        queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
          patches = queuedPatches;
        },
      },
      ribbonExplorer: {
        refresh: () => undefined,
      },
    } as any,
    node,
  );

  const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const updatedAction = updatedDocument.views[0].commandDefinitions[0].actions[0];

  assert.deepStrictEqual(
    updatedAction.kind === "JavaScriptFunction"
      ? updatedAction.parameters.map((item) => item.value)
      : [],
    ["FirstPrimaryItemId", "PrimaryControl", "PrimaryEntityTypeName"],
  );
});

test("moves the same stale details-panel node down after moving it up", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-move-"));
  const filePath = path.join(workspaceRoot, "RibbonDiffXml.xml");
  await fs.writeFile(
    filePath,
    `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="short"><Actions><Url Address="https://short.example" /></Actions></CommandDefinition>
    <CommandDefinition Id="middle">
      <EnableRules>
        <EnableRule Id="new.Enabled" />
      </EnableRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:new_/scripts/account.js" FunctionName="run" />
      </Actions>
    </CommandDefinition>
    <CommandDefinition Id="last"><Actions><Url Address="https://last.example" /></Actions></CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`,
    "utf8",
  );
  const source: RibbonSource = {
    id: "source",
    kind: "flat",
    name: "Source",
    rootUri: workspaceRoot,
    files: [{ fileUri: filePath, kind: "Application" }],
  };
  const state = new RibbonEditorState(new RibbonRepository());
  const [document] = await state.loadSource(source);
  const middle = document.views[0].commandDefinitions[1];
  const staleNode = new RibbonItemNode(
    middle.id,
    undefined,
    "d365RibbonCommandDefinition",
    "gear",
    [],
    [],
    { document, range: middle.range },
  );
  const ctx = {
    configuration: { workspaceRoot },
    ribbonSourceLocator: { locate: async () => [source] },
    ribbonEditorState: state,
    ribbonExplorer: { refresh: () => undefined },
  } as any;

  await moveRibbonNodeUp(ctx, staleNode);
  assert.deepStrictEqual(
    (await state.loadSource(source))[0].views[0].commandDefinitions.map((command) => command.id),
    ["middle", "short", "last"],
  );

  await moveRibbonNodeDown(ctx, staleNode);

  assert.deepStrictEqual(
    (await state.loadSource(source))[0].views[0].commandDefinitions.map((command) => command.id),
    ["short", "middle", "last"],
  );
});

test("moves the same stale JavaScript parameter node down after moving it up", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-param-move-"));
  const filePath = path.join(workspaceRoot, "RibbonDiffXml.xml");
  await fs.writeFile(
    filePath,
    `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <Actions>
        <JavaScriptFunction Library="$webresource:new_/scripts/account.js" FunctionName="run">
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="FirstPrimaryItemId" />
          <CrmParameter Value="PrimaryEntityTypeName" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`,
    "utf8",
  );
  const source: RibbonSource = {
    id: "source",
    kind: "flat",
    name: "Source",
    rootUri: workspaceRoot,
    files: [{ fileUri: filePath, kind: "Application" }],
  };
  const state = new RibbonEditorState(new RibbonRepository());
  const [document] = await state.loadSource(source);
  const action = document.views[0].commandDefinitions[0].actions[0];
  assert.strictEqual(action.kind, "JavaScriptFunction");
  const parameter = action.parameters[1];
  assert.ok(parameter.range);
  const staleNode = new RibbonItemNode(
    `2. ${parameter.value}`,
    parameter.kind,
    "d365RibbonParameter",
    "symbol-parameter",
    [],
    [],
    { document, range: parameter.range },
  );
  const ctx = {
    configuration: { workspaceRoot },
    ribbonSourceLocator: { locate: async () => [source] },
    ribbonEditorState: state,
    ribbonExplorer: { refresh: () => undefined },
  } as any;

  await moveRibbonNodeUp(ctx, staleNode);
  const movedUpAction = (await state.loadSource(source))[0].views[0].commandDefinitions[0]
    .actions[0];
  assert.deepStrictEqual(
    movedUpAction.kind === "JavaScriptFunction"
      ? movedUpAction.parameters.map((item) => item.value)
      : [],
    ["FirstPrimaryItemId", "PrimaryControl", "PrimaryEntityTypeName"],
  );

  await moveRibbonNodeDown(ctx, staleNode);
  const movedDownAction = (await state.loadSource(source))[0].views[0].commandDefinitions[0]
    .actions[0];
  assert.deepStrictEqual(
    movedDownAction.kind === "JavaScriptFunction"
      ? movedDownAction.parameters.map((item) => item.value)
      : [],
    ["PrimaryControl", "FirstPrimaryItemId", "PrimaryEntityTypeName"],
  );
});
