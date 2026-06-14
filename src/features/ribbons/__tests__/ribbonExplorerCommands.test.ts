import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import * as vscode from "vscode";
import JSZip from "jszip";
import { VsCodeNotificationService } from "@platform/vscode/notificationService";
import { MemoryWorkspaceFiles } from "../../../testSupport/fakes";
import { DataverseClient } from "@features/dataverse/dataverseClient";
import { applyRibbonPatchSequence } from "../ribbonPatchWriter";
import { createCustomButtonPatches, createDeleteNodePatch } from "../ribbonEditPatches";
import {
  addCustomRibbonButton,
  addCustomRibbonFlyout,
  addCustomRibbonGroup,
  addCustomRibbonMenuSection,
  addCustomRibbonSplitButton,
  addSmartRibbonButton,
  pickLocation,
} from "../commands/ribbonButtonCommands";
import { addRibbonCommandAction } from "../commands/ribbonCommandDefinitionCommands";
import { addRibbonLocLabelTitle } from "../commands/ribbonLabelCommands";
import {
  addRibbonRuleChildStep,
  deleteRibbonNode,
  editRibbonNode,
  moveRibbonNodeDown,
  moveRibbonNodeUp,
} from "../commands/ribbonNodeCommands";
import {
  extractJavaScriptFunctionSuggestions,
  listBoundJavaScriptLibraries,
  listEnvironmentImageWebResources,
  normalizeWebResourceUniqueName,
} from "../commands/ribbonResourcePrompts";
import {
  addRibbonCommandDisplayRuleRef,
  addRibbonCommandEnableRuleRef,
  addRibbonDisplayRule,
  addRibbonEnableRule,
} from "../commands/ribbonRuleCommands";
import {
  openRibbonSolutionLocation,
  openRibbonsFromSolution,
  publishRibbonToEnvironment,
  removeRibbonSolutionSource,
} from "../commands/ribbonSourceCommands";
import { listRibbonLanguageCodePicks } from "../commands/ribbonLanguagePrompts";
import { createRibbonCascadeDeletePlan } from "../ribbonCascadeDelete";
import { RibbonPatch, RibbonSource, XmlElementRange } from "../models";
import { RibbonEditorState } from "../ribbonEditorState";
import {
  RibbonDocumentNode,
  RibbonItemNode,
  RibbonSectionNode,
  RibbonSourceNode,
  RibbonViewNode,
} from "../ribbonExplorer";
import { RibbonRepository } from "../ribbonRepository";
import { SolutionZipService } from "../solutionZipService";
import { readRibbonDocuments, scanXmlElements } from "../ribbonXmlReader";

function createNotifications(): VsCodeNotificationService {
  return new VsCodeNotificationService();
}

function legacyContext<T extends Record<string, any>>(ctx: T): T {
  return {
    ...ctx,
    core: {
      ...(ctx.core ?? {}),
      configuration: ctx.configuration,
      ui: ctx.ui,
      auth: ctx.auth,
      authorizations: ctx.authorizations,
      secrets: ctx.secrets,
      notifications: ctx.notifications,
      files: ctx.files ?? new MemoryWorkspaceFiles("/workspace"),
      lastSelection: ctx.lastSelection,
      connections: ctx.connections,
      statusBar: ctx.statusBar,
      assemblyStatusBar: ctx.assemblyStatusBar,
    },
    webResource: {
      ...(ctx.webResource ?? {}),
      bindings: ctx.bindings,
      publishCache: ctx.publishCache,
      publisher: ctx.publisher,
      urls: ctx.webResources,
    },
    plugins: {
      ...(ctx.plugins ?? {}),
      explorer: ctx.pluginExplorer,
      registration: ctx.pluginRegistration,
    },
    ribbon: {
      ...(ctx.ribbon ?? {}),
      sourceLocator: ctx.ribbonSourceLocator,
      repository: ctx.ribbonRepository,
      publishService: ctx.ribbonPublishService,
      solutionZipService: ctx.solutionZipService,
      editorState: ctx.ribbonEditorState,
      diagnostics: ctx.ribbonDiagnostics,
      explorer: ctx.ribbonExplorer,
      formPanel: ctx.ribbonFormPanel,
    },
    pcf: {
      ...(ctx.pcf ?? {}),
      processRunner: ctx.pcfProcessRunner,
      pacCli: ctx.pacCli,
      npmRunner: ctx.npmRunner,
      buildService: ctx.pcfBuildService,
      deployService: ctx.pcfDeployService,
      environmentService: ctx.pcfEnvironmentService,
      packageService: ctx.pcfPackageService,
      pushService: ctx.pcfPushService,
      workspaceSettings: ctx.pcfWorkspaceSettings,
      projectLocator: ctx.pcfProjectLocator,
      explorer: ctx.pcfExplorer,
      statusBar: ctx.pcfStatusBar,
      telemetry: ctx.pcfTelemetry,
    },
  };
}

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

test("lists ribbon languages with language codes", () => {
  const picks = listRibbonLanguageCodePicks({ preferredLanguageCode: 1033 });

  assert.deepStrictEqual(picks[0], {
    label: "English (United States)",
    description: "1033",
    detail: "en-US",
    languageCode: 1033,
  });
  assert.deepStrictEqual(
    picks.find((pick) => pick.languageCode === 1058),
    {
      label: "Ukrainian",
      description: "1058",
      detail: "uk-UA",
      languageCode: 1058,
    },
  );
  assert.deepStrictEqual(picks[picks.length - 1], {
    label: "Type language code",
    description: "Use another LCID",
    manual: true,
  });
});

test("prefills custom button text metadata from the label", async () => {
  const source = `<RibbonDiffXml>
  <Templates />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const label = "Validate and save";
  const defaultsByPrompt = new Map<string, string | undefined>();
  let patches: RibbonPatch[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Ribbon location") {
      return items[0];
    }

    if (options.placeHolder === "Button action") {
      return items.find((item) => item.label === "URL");
    }

    if (
      options.placeHolder === "Image 16 web resource" ||
      options.placeHolder === "Image 32 web resource" ||
      options.placeHolder === "Modern image web resource"
    ) {
      return items.find((item) => item.label === "Fill manually");
    }

    return undefined;
  };
  (vscode.window as any).showInputBox = async (options: { prompt?: string; value?: string }) => {
    if (options.prompt) {
      defaultsByPrompt.set(options.prompt, options.value);
    }

    switch (options.prompt) {
      case "Button label":
        return label;
      case "Alt":
      case "Tool tip title":
      case "Tool tip description":
      case "Sequence":
        return options.value ?? "";
      case "Image 16 web resource":
      case "Image 32 web resource":
      case "Modern image web resource":
        return "";
      case "URL":
        return "https://contoso.example/validate";
      default:
        return undefined;
    }
  };

  try {
    await addCustomRibbonButton(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonDocumentNode(document),
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  assert.strictEqual(defaultsByPrompt.get("Alt"), label);
  assert.strictEqual(defaultsByPrompt.get("Tool tip title"), label);
  assert.strictEqual(defaultsByPrompt.get("Tool tip description"), label);

  const updated = applyRibbonPatchSequence(source, patches);
  assert.match(
    updated,
    /Alt="\$LocLabels:d365tools\.application\.[^"]+\.Validate\.and\.save\.Alt"/,
  );
  assert.match(
    updated,
    /ToolTipTitle="\$LocLabels:d365tools\.application\.[^"]+\.Validate\.and\.save\.ToolTipTitle"/,
  );
  assert.match(
    updated,
    /ToolTipDescription="\$LocLabels:d365tools\.application\.[^"]+\.Validate\.and\.save\.ToolTipDescription"/,
  );
  assert.match(updated, /<LocLabel Id="d365tools\.application\.[^"]+\.Validate\.and\.save\.Alt">/);
  assert.match(
    updated,
    /<LocLabel Id="d365tools\.application\.[^"]+\.Validate\.and\.save\.ToolTipTitle">/,
  );
  assert.match(
    updated,
    /<LocLabel Id="d365tools\.application\.[^"]+\.Validate\.and\.save\.ToolTipDescription">/,
  );
});

test("adds a quick JS smart ribbon button from prompts", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions />
  <CommandDefinitions />
  <LocLabels />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  let patches: RibbonPatch[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: any[],
    options: { placeHolder?: string },
  ) => {
    switch (options.placeHolder) {
      case "Smart button template":
        return items.find((item) => item.label === "Quick JS");
      case "Ribbon location":
        return items[0];
      case "JavaScript web resource":
        return items.find((item) => item.label === "Type schema name manually");
      case "JavaScript function name":
        return items.find((item) => item.label === "Type function name") ?? items[0];
      case "CRM parameters":
        return [];
      case "Typed parameters":
        return items.find((item) => item.label === "Done");
      default:
        return undefined;
    }
  };
  (vscode.window as any).showInputBox = async (options: { prompt?: string; value?: string }) => {
    switch (options.prompt) {
      case "Button label":
        return "Run account script";
      case "Sequence":
        return options.value ?? "10";
      case "JavaScript web resource schema name":
        return "new_/scripts/account.js";
      case "JavaScript function name":
        return "runAccountScript";
      default:
        return undefined;
    }
  };

  try {
    await addSmartRibbonButton(
      legacyContext({
        bindings: {
          listBindings: async () => ({ bindings: [] }),
        },
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonViewNode(document, document.views[0]),
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const form = updatedDocument.views[0];
  const button = form.customActions[0].commandUI;
  const action = form.commandDefinitions[0].actions[0];

  assert.strictEqual(button?.kind, "Button");
  assert.strictEqual(action.kind, "JavaScriptFunction");
  assert.strictEqual(
    action.kind === "JavaScriptFunction" ? action.functionName : undefined,
    "runAccountScript",
  );
  assert.match(updated, /Library="\$webresource:new_\/scripts\/account\.js"/);
  assert.match(
    updated,
    /LabelText="\$LocLabels:d365tools\.account\.Form\.Run\.account\.script\.Label"/,
  );
  assert.strictEqual(form.locLabels.length, 3);
});

test("adds a custom ribbon group from prompts", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  let patches: RibbonPatch[] = [];

  const originalShowInputBox = vscode.window.showInputBox;
  (vscode.window as any).showInputBox = async (options: { prompt?: string; value?: string }) => {
    switch (options.prompt) {
      case "Group title":
        return "Custom actions";
      case "Sequence":
        return options.value ?? "10";
      case "Group location":
        return options.value ?? "Mscrm.Form.account.MainTab.Groups._children";
      default:
        return undefined;
    }
  };

  try {
    await addCustomRibbonGroup(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonViewNode(document, document.views[0]),
    );
  } finally {
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const group = updatedDocument.views[0].customActions[0].commandUI;

  assert.strictEqual(group?.kind, "Group");
  assert.strictEqual(group?.kind === "Group" ? group.title : undefined, "Custom actions");
  assert.match(updated, /Location="Mscrm\.Form\.account\.MainTab\.Groups\._children"/);
});

test("adds a custom ribbon menu section from prompts", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  let patches: RibbonPatch[] = [];

  const originalShowInputBox = vscode.window.showInputBox;
  const originalShowQuickPick = vscode.window.showQuickPick;
  (vscode.window as any).showInputBox = async (options: { prompt?: string; value?: string }) => {
    switch (options.prompt) {
      case "Menu section name":
        return "More actions";
      case "Sequence":
        return options.value ?? "10";
      case "Menu section location":
        return "Mscrm.Form.account.MainTab.Actions.MenuSections._children";
      default:
        return undefined;
    }
  };
  (vscode.window as any).showQuickPick = async (
    items: string[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Menu section display mode") {
      return items[0];
    }

    return undefined;
  };

  try {
    await addCustomRibbonMenuSection(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonViewNode(document, document.views[0]),
    );
  } finally {
    (vscode.window as any).showInputBox = originalShowInputBox;
    (vscode.window as any).showQuickPick = originalShowQuickPick;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const menuSection = updatedDocument.views[0].customActions[0].commandUI;

  assert.strictEqual(menuSection?.kind, "MenuSection");
  assert.strictEqual(
    menuSection?.kind === "MenuSection" ? menuSection.displayMode : undefined,
    "Menu16",
  );
  assert.match(
    updated,
    /Location="Mscrm\.Form\.account\.MainTab\.Actions\.MenuSections\._children"/,
  );
});

test("adds a custom ribbon flyout from prompts", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  let patches: RibbonPatch[] = [];

  const originalShowInputBox = vscode.window.showInputBox;
  (vscode.window as any).showInputBox = async (options: { prompt?: string; value?: string }) => {
    switch (options.prompt) {
      case "Flyout label":
        return "More actions";
      case "Sequence":
        return options.value ?? "10";
      case "Flyout location":
        return "Mscrm.Form.account.MainTab.Actions.Controls._children";
      default:
        return undefined;
    }
  };

  try {
    await addCustomRibbonFlyout(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonViewNode(document, document.views[0]),
    );
  } finally {
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const flyout = updatedDocument.views[0].customActions[0].commandUI;

  assert.strictEqual(flyout?.kind, "Flyout");
  assert.match(updated, /Location="Mscrm\.Form\.account\.MainTab\.Actions\.Controls\._children"/);
  assert.match(updated, /<FlyoutAnchor Id="d365tools\.account\.Form\.More\.actions\.Flyout"/);
  assert.match(updated, /<LocLabel Id="d365tools\.account\.Form\.More\.actions\.Flyout\.Label">/);
});

test("adds a custom ribbon split button from prompts", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  let patches: RibbonPatch[] = [];

  const originalShowInputBox = vscode.window.showInputBox;
  (vscode.window as any).showInputBox = async (options: { prompt?: string; value?: string }) => {
    switch (options.prompt) {
      case "Split button label":
        return "Main action";
      case "Sequence":
        return options.value ?? "10";
      case "Split button location":
        return "Mscrm.Form.account.MainTab.Actions.Controls._children";
      default:
        return undefined;
    }
  };

  try {
    await addCustomRibbonSplitButton(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonViewNode(document, document.views[0]),
    );
  } finally {
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const splitButton = updatedDocument.views[0].customActions[0].commandUI;

  assert.strictEqual(splitButton?.kind, "SplitButton");
  assert.match(updated, /Location="Mscrm\.Form\.account\.MainTab\.Actions\.Controls\._children"/);
  assert.match(updated, /<SplitButton Id="d365tools\.account\.Form\.Main\.action\.SplitButton"/);
  assert.match(
    updated,
    /<LocLabel Id="d365tools\.account\.Form\.Main\.action\.SplitButton\.Label">/,
  );
});

test("adds a child button to a selected flyout from prompts", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.account.More.Action" Location="Mscrm.Form.account.MainTab.Actions.Controls._children">
      <CommandUIDefinition>
        <FlyoutAnchor Id="new.account.More.Flyout" LabelText="More" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const flyout = document.views[0].customActions[0].commandUI;
  assert.strictEqual(flyout?.kind, "Flyout");
  let patches: RibbonPatch[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;
  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Button action") {
      return items.find((item) => item.label === "URL");
    }

    if (
      options.placeHolder === "Image 16 web resource" ||
      options.placeHolder === "Image 32 web resource" ||
      options.placeHolder === "Modern image web resource"
    ) {
      return items.find((item) => item.label === "Fill manually");
    }

    return undefined;
  };
  (vscode.window as any).showInputBox = async (options: { prompt?: string; value?: string }) => {
    switch (options.prompt) {
      case "Button label":
        return "Child action";
      case "Alt":
      case "Tool tip title":
      case "Tool tip description":
      case "Sequence":
        return options.value ?? "";
      case "Image 16 web resource":
      case "Image 32 web resource":
      case "Modern image web resource":
        return "";
      case "URL":
        return "https://contoso.example/child";
      default:
        return undefined;
    }
  };

  try {
    await addCustomRibbonButton(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonItemNode(
        "Flyout: new.account.More.Flyout",
        undefined,
        "d365RibbonFlyout",
        "list-tree",
        [],
        [],
        { document, range: flyout.range },
      ),
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const updatedFlyout = updatedDocument.views[0].customActions[0].commandUI;
  const section = updatedFlyout?.kind === "Flyout" ? updatedFlyout.children?.[0] : undefined;
  const button = section?.kind === "MenuSection" ? section.children?.[0] : undefined;

  assert.strictEqual(button?.kind, "Button");
  assert.match(updated, /<MenuSection Id="new\.account\.More\.Flyout\.MenuSection"/);
  assert.match(updated, /<Url Address="https:\/\/contoso\.example\/child" \/>/);
});

test("edits a custom group without rebuilding child controls", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="old.Action" Location="Mscrm.Form.account.MainTab.Groups._children" Sequence="10">
      <CommandUIDefinition>
        <Group Id="old.Group" Title="Old group" Sequence="10">
          <Controls Id="old.Group.Controls">
            <Button Id="old.Button" Command="old.Command" LabelText="Keep child" />
          </Controls>
        </Group>
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const action = document.views[0].customActions[0];
  const node = new RibbonItemNode(
    "CustomAction: old.Action",
    undefined,
    "d365RibbonCustomAction",
    "symbol-event",
    [],
    [],
    { document, range: action.range },
  );
  let patches: RibbonPatch[] = [];

  const originalShowInputBox = vscode.window.showInputBox;
  (vscode.window as any).showInputBox = async (options: { prompt?: string }) => {
    switch (options.prompt) {
      case "Custom action id":
        return "new.Action";
      case "Location":
        return "Mscrm.Form.account.MainTab.Groups._children";
      case "Group id":
        return "new.Group";
      case "Group title":
        return "New group";
      case "Sequence":
        return "20";
      default:
        return undefined;
    }
  };

  try {
    await editRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const group = updatedDocument.views[0].customActions[0].commandUI;
  const child = group?.kind === "Group" ? group.children?.[0] : undefined;

  assert.strictEqual(updatedDocument.views[0].customActions[0].id, "new.Action");
  assert.strictEqual(group?.kind === "Group" ? group.id : undefined, "new.Group");
  assert.strictEqual(group?.kind === "Group" ? group.title : undefined, "New group");
  assert.strictEqual(child?.kind === "Button" ? child.id : undefined, "old.Button");
});

test("presents OOB ribbon locations with their buttons and sequences", async () => {
  const source = `<RibbonDiffXml>
  <Templates />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  let locationItems: vscode.QuickPickItem[] = [];
  const originalShowQuickPick = vscode.window.showQuickPick;
  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Ribbon location") {
      locationItems = items;
      return items.find((item) => item.label === "Save");
    }

    return undefined;
  };

  let location: string | undefined;
  try {
    location = await pickLocation(document, "Form");
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
  }

  assert.strictEqual(location, "Mscrm.Form.account.MainTab.Save.Controls._children");

  const save = locationItems.find((item) => item.label === "Save");
  assert.strictEqual(save?.description, "Save (10), Save and close (20), Save and new (30)");
  assert.strictEqual(save?.detail, "Mscrm.Form.account.MainTab.Save.Controls._children");

  const collaborate = locationItems.find((item) => item.label === "Collaborate");
  assert.strictEqual(collaborate?.description, "Share (10), Email link (20), Copy link (30)");

  const modernClient = locationItems.find((item) => item.label === "ModernClient");
  assert.strictEqual(
    modernClient?.detail,
    "Mscrm.Form.account.MainTab.ModernClient.Controls._children",
  );

  assert.ok(locationItems.some((item) => (item as { manual?: boolean }).manual));
});

test("includes existing custom buttons in the location contents", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.account.Form.Validate.CustomAction" Location="Mscrm.Form.account.MainTab.Save.Controls._children" Sequence="15">
      <CommandUIDefinition>
        <Button Id="new.account.Form.Validate.Button" Command="new.account.Form.Validate.Command" LabelText="Validate" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <Templates />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  let locationItems: vscode.QuickPickItem[] = [];
  const originalShowQuickPick = vscode.window.showQuickPick;
  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Ribbon location") {
      locationItems = items;
      return items.find((item) => item.label === "Save");
    }

    return undefined;
  };

  try {
    await pickLocation(document, "Form");
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
  }

  const save = locationItems.find((item) => item.label === "Save");
  assert.strictEqual(
    save?.description,
    "Save (10), Validate (15), Save and close (20), Save and new (30)",
  );
});

test("surfaces non-catalog group locations already used by the document", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="mso.OpenCv.CustomAction" Location="Mscrm.Form.account.MainTab.Management.Controls._children" Sequence="10">
      <CommandUIDefinition>
        <Button Id="mso.OpenCv.Button" Command="mso.OpenCv.Command" LabelText="Open CV" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <Templates />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  let locationItems: vscode.QuickPickItem[] = [];
  const originalShowQuickPick = vscode.window.showQuickPick;
  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Ribbon location") {
      locationItems = items;
      return items.find((item) => item.label === "Management");
    }

    return undefined;
  };

  let location: string | undefined;
  try {
    location = await pickLocation(document, "Form");
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
  }

  assert.strictEqual(location, "Mscrm.Form.account.MainTab.Management.Controls._children");

  const management = locationItems.find((item) => item.label === "Management");
  assert.strictEqual(management?.description, "Open CV (10)");
  assert.strictEqual(
    management?.detail,
    "Mscrm.Form.account.MainTab.Management.Controls._children",
  );
});

test("shows the last segment of $Resources button labels", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="mso.Activate.CustomAction" Location="Mscrm.Form.account.MainTab.ModernClient.Controls._children" Sequence="50">
      <CommandUIDefinition>
        <Button Id="mso.Activate.Button" Command="mso.Activate.Command" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Status.Activate" />
      </CommandUIDefinition>
    </CustomAction>
    <CustomAction Id="mso.Deactivate.CustomAction" Location="Mscrm.Form.account.MainTab.ModernClient.Controls._children" Sequence="60">
      <CommandUIDefinition>
        <Button Id="mso.Deactivate.Button" Command="mso.Deactivate.Command" LabelText="$Resources:Ribbon.HomepageGrid.account.Record.Status.Deactivate" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <Templates />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  let locationItems: vscode.QuickPickItem[] = [];
  const originalShowQuickPick = vscode.window.showQuickPick;
  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Ribbon location") {
      locationItems = items;
      return items.find((item) => item.label === "ModernClient");
    }

    return undefined;
  };

  try {
    await pickLocation(document, "Form");
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
  }

  const modernClient = locationItems.find((item) => item.label === "ModernClient");
  assert.strictEqual(modernClient?.description, "Activate (50), Deactivate (60)");
});

test("does not prefill empty custom button text metadata from label while editing", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.Action" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.Button" Command="new.Command" LabelText="$LocLabels:new.Label" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <LocLabels>
    <LocLabel Id="new.Label">
      <Titles>
        <Title languagecode="1033" description="Run report" />
      </Titles>
    </LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const action = document.views[0].customActions[0];
  const node = new RibbonItemNode(
    "CustomAction: new.Action",
    undefined,
    "d365RibbonCustomAction",
    "symbol-event",
    [],
    [],
    { document, range: action.range },
  );
  const defaultsByPrompt = new Map<string, string | undefined>();
  let patches: RibbonPatch[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Ribbon location") {
      return items.find((item) => (item as { manual?: boolean }).manual);
    }

    if (
      options.placeHolder === "Image 16 web resource" ||
      options.placeHolder === "Image 32 web resource" ||
      options.placeHolder === "Modern image web resource"
    ) {
      return items.find((item) => item.label === "Fill manually");
    }

    return undefined;
  };

  (vscode.window as any).showInputBox = async (options: { prompt?: string; value?: string }) => {
    if (options.prompt) {
      defaultsByPrompt.set(options.prompt, options.value);
    }

    return options.value ?? "";
  };

  try {
    await editRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  assert.strictEqual(defaultsByPrompt.get("Button label"), "Run report");
  assert.strictEqual(defaultsByPrompt.has("Button label Id"), false);
  assert.strictEqual(defaultsByPrompt.get("Alt"), "");
  assert.strictEqual(defaultsByPrompt.get("Tool tip title"), "");
  assert.strictEqual(defaultsByPrompt.get("Tool tip description"), "");

  const updated = applyRibbonPatchSequence(source, patches);
  assert.match(updated, /LabelText="\$LocLabels:new\.Label"/);
  assert.doesNotMatch(updated, /LabelText="Run report"/);
  assert.doesNotMatch(updated, /Alt=/);
  assert.doesNotMatch(updated, /ToolTipTitle=/);
  assert.doesNotMatch(updated, /ToolTipDescription=/);
});

test("creates missing custom button metadata loc labels while editing", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.Action" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.Button" Command="new.Command" LabelText="$LocLabels:new.Label" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <LocLabels>
    <LocLabel Id="new.Label">
      <Titles>
        <Title languagecode="1033" description="Run report" />
      </Titles>
    </LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const action = document.views[0].customActions[0];
  const node = new RibbonItemNode(
    "CustomAction: new.Action",
    undefined,
    "d365RibbonCustomAction",
    "symbol-event",
    [],
    [],
    { document, range: action.range },
  );
  let patches: RibbonPatch[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Ribbon location") {
      return items.find((item) => (item as { manual?: boolean }).manual);
    }

    if (
      options.placeHolder === "Image 16 web resource" ||
      options.placeHolder === "Image 32 web resource" ||
      options.placeHolder === "Modern image web resource"
    ) {
      return items.find((item) => item.label === "Fill manually");
    }

    return undefined;
  };

  (vscode.window as any).showInputBox = async (options: { prompt?: string; value?: string }) => {
    if (options.prompt === "Alt") {
      return "Run report";
    }
    if (options.prompt === "Tool tip description") {
      return "Run the report";
    }

    return options.value ?? "";
  };

  try {
    await editRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const updatedButton = updatedDocument.views[0].customActions[0].commandUI;
  assert.strictEqual(updatedButton?.kind, "Button");
  assert.strictEqual(
    updatedButton.kind === "Button" ? updatedButton.labelLocId : undefined,
    "new.Label",
  );
  assert.strictEqual(
    updatedButton.kind === "Button" ? updatedButton.altLocId : undefined,
    "new.Alt",
  );
  assert.strictEqual(
    updatedButton.kind === "Button" ? updatedButton.toolTipDescriptionLocId : undefined,
    "new.ToolTipDescription",
  );
  assert.deepStrictEqual(
    updatedDocument.views[0].locLabels.map((label) => label.id),
    ["new.Label", "new.Alt", "new.ToolTipDescription"],
  );
  assert.strictEqual(updatedDocument.views[0].locLabels[1].titles[0].description, "Run report");
  assert.strictEqual(updatedDocument.views[0].locLabels[2].titles[0].description, "Run the report");
  assert.doesNotMatch(updated, /ToolTipTitle=/);
});

test("edits custom button loc label text from custom action", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.Action" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.Button" Command="new.Command" LabelText="$LocLabels:new.Label" Alt="$LocLabels:new.Alt" ToolTipTitle="$LocLabels:new.ToolTipTitle" ToolTipDescription="$LocLabels:new.ToolTipDescription" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <LocLabels>
    <LocLabel Id="new.Label"><Titles><Title languagecode="1033" description="Send" /></Titles></LocLabel>
    <LocLabel Id="new.Alt"><Titles><Title languagecode="1033" description="Send" /></Titles></LocLabel>
    <LocLabel Id="new.ToolTipTitle"><Titles><Title languagecode="1033" description="Send" /></Titles></LocLabel>
    <LocLabel Id="new.ToolTipDescription"><Titles><Title languagecode="1033" description="Send" /></Titles></LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const action = document.views[0].customActions[0];
  const node = new RibbonItemNode(
    "CustomAction: new.Action",
    undefined,
    "d365RibbonCustomAction",
    "symbol-event",
    [],
    [],
    { document, range: action.range },
  );
  let patches: RibbonPatch[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Ribbon location") {
      return items.find((item) => (item as { manual?: boolean }).manual);
    }

    if (
      options.placeHolder === "Image 16 web resource" ||
      options.placeHolder === "Image 32 web resource" ||
      options.placeHolder === "Modern image web resource"
    ) {
      return items.find((item) => item.label === "Fill manually");
    }

    return undefined;
  };

  (vscode.window as any).showInputBox = async (options: { prompt?: string; value?: string }) => {
    switch (options.prompt) {
      case "Button label":
        return "Send to Service";
      case "Alt":
        return "Send to service";
      case "Tool tip title":
        return "Send to service";
      case "Tool tip description":
        return "Send account to service";
      default:
        return options.value ?? "";
    }
  };

  try {
    await editRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  assert.match(updated, /LabelText="\$LocLabels:new\.Label"/);
  assert.match(updated, /Alt="\$LocLabels:new\.Alt"/);
  assert.match(updated, /ToolTipTitle="\$LocLabels:new\.ToolTipTitle"/);
  assert.match(updated, /ToolTipDescription="\$LocLabels:new\.ToolTipDescription"/);
  assert.match(updated, /<Title languagecode="1033" description="Send to Service" \/>/);
  assert.match(updated, /<Title languagecode="1033" description="Send to service" \/>/);
  assert.match(updated, /<Title languagecode="1033" description="Send account to service" \/>/);
});

test("opens ribbon source location in the OS", async () => {
  const source: RibbonSource = {
    id: "zip:/tmp/core",
    kind: "zip",
    name: "core.zip",
    rootUri: "/tmp/core",
    files: [],
    zip: {
      extractedRootUri: "/tmp/core",
      entries: [],
    },
  };
  const node = new RibbonSourceNode(source);
  const originalExecuteCommand = vscode.commands.executeCommand;
  let executedCommand: string | undefined;
  let openedPath: string | undefined;

  (vscode.commands as any).executeCommand = async (command: string, uri: vscode.Uri) => {
    executedCommand = command;
    openedPath = uri.fsPath;
  };

  try {
    await openRibbonSolutionLocation({} as any, node);
  } finally {
    (vscode.commands as any).executeCommand = originalExecuteCommand;
  }

  assert.strictEqual(executedCommand, "revealFileInOS");
  assert.strictEqual(openedPath, "/tmp/core");
});

test("removes imported ribbon solution after confirmation", async () => {
  const source: RibbonSource = {
    id: "zip:/tmp/core",
    kind: "zip",
    name: "core.zip",
    rootUri: "/tmp/core",
    files: [{ fileUri: "/tmp/core/customizations.xml", kind: "Flat" }],
    zip: {
      extractedRootUri: "/tmp/core",
      entries: ["customizations.xml"],
    },
  };
  const node = new RibbonSourceNode(source);
  const originalShowWarningMessage = vscode.window.showWarningMessage;
  let removedSourceId: string | undefined;
  let cleanedSourceId: string | undefined;
  let refreshed = false;
  let confirmationDetail = "";

  (vscode.window as any).showWarningMessage = async (
    _message: string,
    options: { detail?: string },
    action: string,
  ) => {
    confirmationDetail = options.detail ?? "";
    return action;
  };

  try {
    await removeRibbonSolutionSource(
      legacyContext({
        ribbonSourceLocator: {
          removeImportedSource: (sourceId: string) => {
            removedSourceId = sourceId;
            return true;
          },
        },
        ribbonEditorState: {
          isSourceDirty: () => true,
          removeSource: (sourceId: string) => {
            cleanedSourceId = sourceId;
          },
        },
        ribbonExplorer: {
          refresh: () => {
            refreshed = true;
          },
        },
        notifications: createNotifications(),
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  assert.strictEqual(removedSourceId, source.id);
  assert.strictEqual(cleanedSourceId, source.id);
  assert.strictEqual(refreshed, true);
  assert.match(confirmationDetail, /Unsaved ribbon edits/);
});

test("adds command action from actions group node", async () => {
  const workspaceRoot = "/workspace/d365-ribbon-action";
  const files = new MemoryWorkspaceFiles(workspaceRoot);
  files.addFile(
    path.join(workspaceRoot, "src/account/ribbon.js"),
    `function onValidateAndSaveClick() {
  return true;
}`,
  );

  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <Actions><Url Address="https://first.example" /></Actions>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const command = document.views[0].commandDefinitions[0];
  const node = new RibbonItemNode("Actions", "1", "d365RibbonActions", "run", [], [], {
    document,
    range: command.range,
  });
  let patches: RibbonPatch[] = [];
  let refreshed = false;
  let functionItems: vscode.QuickPickItem[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

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
  (vscode.window as any).showInputBox = async (options: { prompt?: string }) => {
    if (options.prompt === "URL") {
      return "https://second.example";
    }

    return undefined;
  };

  try {
    await addRibbonCommandAction(
      legacyContext({
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
        files,
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => {
            refreshed = true;
          },
        },
        notifications: createNotifications(),
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.strictEqual(refreshed, true);
  assert.deepStrictEqual(
    functionItems.map((item) => item.label),
    ["isNaN", "onValidateAndSaveClick", "Type function name"],
  );
  assert.deepStrictEqual(
    updatedDocument.views[0].commandDefinitions[0].actions.map((action) =>
      action.kind === "Url"
        ? action.address
        : action.kind === "JavaScriptFunction"
          ? action.functionName
          : action.kind,
    ),
    ["https://first.example", "isNaN"],
  );
});

test("adds URL command action parameters from a list flow", async () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <Actions />
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const command = document.views[0].commandDefinitions[0];
  const node = new RibbonItemNode("Actions", "0", "d365RibbonActions", "run", [], [], {
    document,
    range: command.range,
  });
  let patches: RibbonPatch[] = [];
  const parameterListLabels: string[][] = [];
  let crmParameterLabels: string[] = [];
  const parameterKinds = ["Crm", "String"];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Command action") {
      return items.find((item) => item.label === "URL");
    }

    if (options.placeHolder === "URL parameters") {
      parameterListLabels.push(items.map((item) => item.label));
      return parameterListLabels.length <= 2
        ? items.find((item) => item.label === "Add parameter")
        : items.find((item) => item.label === "Done");
    }

    if (options.placeHolder === "Parameter kind") {
      const label = parameterKinds.shift();
      return items.find((item) => item.label === label);
    }

    if (options.placeHolder === "CRM parameter") {
      crmParameterLabels = items.map((item) => item.label);
      return items.find((item) => item.label === "FirstPrimaryItemId");
    }

    if (options.placeHolder === "Pass URL context parameters") {
      return items.find((item) => item.label === "true");
    }

    if (options.placeHolder === "Window mode") {
      return items.find((item) => item.label === "1");
    }

    return undefined;
  };
  (vscode.window as any).showInputBox = async (options: { prompt?: string }) => {
    switch (options.prompt) {
      case "URL":
        return "$webresource:new_/page.htm";
      case "Parameter name":
        return parameterKinds.length === 1 ? "recordId" : "data";
      case "Parameter value":
        return "source";
      case "Window params":
        return "height=600,width=800";
      default:
        return undefined;
    }
  };

  try {
    await addRibbonCommandAction(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  const updated = applyRibbonPatchSequence(source, patches);

  assert.deepStrictEqual(parameterListLabels, [
    ["Done", "Add parameter"],
    ["Done", "Add parameter", "1. Crm:recordId=FirstPrimaryItemId"],
    ["Done", "Add parameter", "1. Crm:recordId=FirstPrimaryItemId", "2. String:data=source"],
  ]);
  assert.ok(crmParameterLabels.includes("FirstPrimaryItemId"));
  assert.match(
    updated,
    /<Url Address="\$webresource:new_\/page\.htm" PassParams="true" WinMode="1" WinParams="height=600,width=800">/,
  );
  assert.match(updated, /<CrmParameter Name="recordId" Value="FirstPrimaryItemId" \/>/);
  assert.match(updated, /<StringParameter Name="data" Value="source" \/>/);
});

test("adds command enable rule reference from enable rules group node", async () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <EnableRules />
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions>
    <EnableRules>
      <EnableRule Id="new.Enabled" />
    </EnableRules>
  </RuleDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const command = document.views[0].commandDefinitions[0];
  const node = new RibbonItemNode(
    "EnableRules",
    "0",
    "d365RibbonEnableRuleRefs",
    "references",
    [],
    [],
    { document, range: command.range },
  );
  let patches: RibbonPatch[] = [];
  let refreshed = false;

  const originalShowQuickPick = vscode.window.showQuickPick;

  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Enable rule") {
      return items.find((item) => item.label === "new.Enabled");
    }

    return undefined;
  };

  try {
    await addRibbonCommandEnableRuleRef(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => {
            refreshed = true;
          },
        },
        notifications: createNotifications(),
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.strictEqual(refreshed, true);
  assert.deepStrictEqual(updatedDocument.views[0].commandDefinitions[0].enableRuleRefs, [
    "new.Enabled",
  ]);
});

test("adds built-in command enable rule references", async () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <EnableRules><EnableRule Id="Mscrm.SelectionCountExactlyOne" /></EnableRules>
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions>
    <EnableRules><EnableRule Id="mso.account.Pptx.EnableRule" /></EnableRules>
  </RuleDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const command = document.views[0].commandDefinitions[0];
  const node = new RibbonItemNode(
    "EnableRules",
    "1",
    "d365RibbonEnableRuleRefs",
    "references",
    [],
    [],
    { document, range: command.range },
  );
  let patches: RibbonPatch[] = [];
  let offeredLabels: string[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;

  (vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
    offeredLabels = items.map((item) => item.label);
    return items.find((item) => item.label === "Mscrm.ShowOnGrid");
  };

  try {
    await addRibbonCommandEnableRuleRef(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
  }

  assert.deepStrictEqual(offeredLabels.slice(0, 3), [
    "Add new enable rule",
    "mso.account.Pptx.EnableRule",
    "Type enable rule id",
  ]);
  assert.ok(!offeredLabels.includes("Mscrm.SelectionCountExactlyOne"));
  assert.ok(offeredLabels.includes("Mscrm.ShowOnGrid"));

  const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.deepStrictEqual(updatedDocument.views[0].commandDefinitions[0].enableRuleRefs, [
    "Mscrm.SelectionCountExactlyOne",
    "Mscrm.ShowOnGrid",
  ]);
});

test("creates new enable rule and references it from command refs", async () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.account.Form.Validate.Command" />
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const command = document.views[0].commandDefinitions[0];
  const node = new RibbonItemNode(
    "EnableRules",
    "0",
    "d365RibbonEnableRuleRefs",
    "references",
    [],
    [],
    { document, range: command.range },
  );
  let patches: RibbonPatch[] = [];
  const offeredLabels: string[] = [];
  const inputValues: string[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Enable rule") {
      offeredLabels.push(...items.map((item) => item.label));
      return items.find((item) => item.label === "Add new enable rule");
    }

    if (options.placeHolder === "First rule step") {
      return items.find((item) => item.label === "No step");
    }

    return undefined;
  };
  (vscode.window as any).showInputBox = async (options: { value?: string }) => {
    inputValues.push(options.value ?? "");
    return options.value;
  };

  try {
    await addRibbonCommandEnableRuleRef(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  assert.deepStrictEqual(offeredLabels.slice(0, 2), ["Add new enable rule", "Type enable rule id"]);
  assert.deepStrictEqual(inputValues, ["new.account.Form.Validate.EnableRule"]);

  const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.deepStrictEqual(
    updatedDocument.views[0].enableRules.map((rule) => rule.id),
    ["new.account.Form.Validate.EnableRule"],
  );
  assert.deepStrictEqual(updatedDocument.views[0].commandDefinitions[0].enableRuleRefs, [
    "new.account.Form.Validate.EnableRule",
  ]);
});

test("creates common enable rules from prompts", async () => {
  const source = `<RibbonDiffXml>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const cases = [
    {
      inputByPrompt: new Map([
        ["Enable rule id", "new.SelectionCount"],
        ["Selected rows", "1"],
      ]),
      pickByPlaceHolder: new Map([
        ["First rule step", "SelectionCountRule"],
        ["Applies to", "SelectedEntity"],
        ["Selected row condition", "Equal to"],
        ["Invert result?", "No"],
      ]),
      expectedKind: "SelectionCountRule",
    },
    {
      inputByPrompt: new Map([["Enable rule id", "new.RecordPrivilege"]]),
      pickByPlaceHolder: new Map([
        ["First rule step", "RecordPrivilegeRule"],
        ["Privilege type", "AppendTo"],
        ["Applies to", "PrimaryEntity"],
        ["Invert result?", "No"],
      ]),
      expectedKind: "RecordPrivilegeRule",
    },
    {
      inputByPrompt: new Map([
        ["Enable rule id", "new.Entity"],
        ["Entity logical name", "account"],
        ["Context", "HomePageGrid"],
      ]),
      pickByPlaceHolder: new Map([
        ["First rule step", "EntityRule"],
        ["Entity logical name", "Type logical name manually"],
        ["Applies to", "SelectedEntity"],
        ["Invert result?", "No"],
      ]),
      expectedKind: "EntityRule",
    },
  ];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  try {
    for (const item of cases) {
      let patches: RibbonPatch[] = [];
      (vscode.window as any).showQuickPick = async (
        picks: vscode.QuickPickItem[] | string[],
        options: { placeHolder?: string },
      ) => {
        const label = item.pickByPlaceHolder.get(options.placeHolder ?? "");
        return typeof picks[0] === "string"
          ? label
          : (picks as vscode.QuickPickItem[]).find((pick) => pick.label === label);
      };
      (vscode.window as any).showInputBox = async (options: { prompt?: string }) =>
        item.inputByPrompt.get(options.prompt ?? "");

      await addRibbonEnableRule(
        legacyContext({
          ribbonEditorState: {
            queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
              patches = queuedPatches;
            },
          },
          ribbonExplorer: {
            refresh: () => undefined,
          },
        } as any),
        new RibbonDocumentNode(document),
      );

      const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
        sourceId: "source",
        fileUri: "/tmp/RibbonDiffXml.xml",
        kind: "Application",
      });

      assert.strictEqual(updatedDocument.views[0].enableRules[0].steps[0].kind, item.expectedKind);
    }
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }
});

test("creates value rules from environment field metadata", async () => {
  const source = `<RibbonDiffXml>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  let patches: RibbonPatch[] = [];
  const requestedPaths: string[] = [];
  let fieldPickItems: vscode.QuickPickItem[] = [];
  let fieldPromptCount = 0;

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    picks: vscode.QuickPickItem[] | string[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "First rule step") {
      return (picks as vscode.QuickPickItem[]).find((pick) => pick.label === "ValueRule");
    }

    if (options.placeHolder === "Field name") {
      fieldPromptCount += 1;
      if (fieldPromptCount === 1) {
        return (picks as vscode.QuickPickItem[]).find((pick) => pick.label === "Pick from account");
      }

      fieldPickItems = picks as vscode.QuickPickItem[];
      return fieldPickItems.find((pick) => pick.label === "statuscode");
    }

    if (options.placeHolder === "Invert result?") {
      return typeof picks[0] === "string"
        ? "No"
        : (picks as vscode.QuickPickItem[]).find((pick) => pick.label === "No");
    }

    return undefined;
  };
  (vscode.window as any).showInputBox = async (options: { prompt?: string }) => {
    switch (options.prompt) {
      case "Enable rule id":
        return "new.Value";
      case "Value":
        return "1";
      default:
        return undefined;
    }
  };

  try {
    await addRibbonEnableRule(
      legacyContext({
        configuration: {
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
          createClient: async () => ({
            get: async (path: string) => {
              requestedPaths.push(path);
              return {
                value: [
                  {
                    LogicalName: "statuscode",
                    DisplayName: { UserLocalizedLabel: { Label: "Status Reason" } },
                  },
                  { LogicalName: "name" },
                ],
              };
            },
          }),
        },
        notifications: createNotifications(),
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonViewNode(document, document.views[0]),
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  assert.deepStrictEqual(requestedPaths, [
    "/EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName,DisplayName",
  ]);
  assert.strictEqual(
    fieldPickItems.find((item) => item.label === "statuscode")?.description,
    "Status Reason",
  );

  const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const step = updatedDocument.views[0].enableRules[0].steps[0];

  assert.strictEqual(step.kind, "ValueRule");
  assert.strictEqual(step.kind === "ValueRule" ? step.field : undefined, "statuscode");
});

test("creates flat display rules from prompts", async () => {
  const source = `<RibbonDiffXml>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const cases = [
    {
      inputByPrompt: new Map([["Display rule id", "new.FormType"]]),
      pickByPlaceHolder: new Map([
        ["First rule step", "FormTypeRule"],
        ["Form type", "Main"],
        ["Invert result?", "No"],
      ]),
      expectedKind: "FormTypeRule",
    },
    {
      inputByPrompt: new Map([["Display rule id", "new.EntityProperty"]]),
      pickByPlaceHolder: new Map([
        ["First rule step", "EntityPropertyRule"],
        ["Entity property", "HasNotes"],
        ["Property value", "Yes"],
        ["Invert result?", "No"],
      ]),
      expectedKind: "EntityPropertyRule",
    },
    {
      inputByPrompt: new Map([["Display rule id", "new.MiscPrivilege"]]),
      pickByPlaceHolder: new Map([
        ["First rule step", "MiscellaneousPrivilegeRule"],
        ["Privilege name", "ExportToExcel"],
        ["Privilege depth", "No value"],
        ["Invert result?", "No"],
      ]),
      expectedKind: "MiscellaneousPrivilegeRule",
    },
    {
      inputByPrompt: new Map([
        ["Display rule id", "new.OrganizationSetting"],
        ["Organization setting", "IsSharePointIntegrationEnabled"],
      ]),
      pickByPlaceHolder: new Map([
        ["First rule step", "OrganizationSettingRule"],
        ["Organization setting", "Type organization setting"],
        ["Invert result?", "No"],
      ]),
      expectedKind: "OrganizationSettingRule",
      expectedSetting: "IsSharePointIntegrationEnabled",
    },
    {
      inputByPrompt: new Map([["Display rule id", "new.HideForTablet"]]),
      pickByPlaceHolder: new Map([
        ["First rule step", "HideForTabletExperienceRule"],
        ["Invert result?", "No"],
      ]),
      expectedKind: "HideForTabletExperienceRule",
    },
    {
      inputByPrompt: new Map([["Display rule id", "new.RelationshipType"]]),
      pickByPlaceHolder: new Map([
        ["First rule step", "RelationshipTypeRule"],
        ["Relationship type", "OneToMany"],
        ["Invert result?", "No"],
      ]),
      expectedKind: "RelationshipTypeRule",
    },
    {
      inputByPrompt: new Map([["Display rule id", "new.ReferencingRequired"]]),
      pickByPlaceHolder: new Map([
        ["First rule step", "ReferencingAttributeRequiredRule"],
        ["Invert result?", "No"],
      ]),
      expectedKind: "ReferencingAttributeRequiredRule",
    },
    {
      inputByPrompt: new Map([
        ["Display rule id", "new.Page"],
        ["Page address", "/dashboards/dashboard.aspx"],
      ]),
      pickByPlaceHolder: new Map([
        ["First rule step", "PageRule"],
        ["Invert result?", "No"],
      ]),
      expectedKind: "PageRule",
      expectedAddress: "/dashboards/dashboard.aspx",
    },
    {
      inputByPrompt: new Map([["Display rule id", "new.Or"]]),
      pickByPlaceHolder: new Map([["First rule step", "OrRule"]]),
      expectedKind: "OrRule",
    },
  ];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  try {
    for (const item of cases) {
      let patches: RibbonPatch[] = [];
      (vscode.window as any).showQuickPick = async (
        picks: vscode.QuickPickItem[] | string[],
        options: { placeHolder?: string },
      ) => {
        const label = item.pickByPlaceHolder.get(options.placeHolder ?? "");
        return typeof picks[0] === "string"
          ? label
          : (picks as vscode.QuickPickItem[]).find((pick) => pick.label === label);
      };
      (vscode.window as any).showInputBox = async (options: { prompt?: string }) =>
        item.inputByPrompt.get(options.prompt ?? "");

      await addRibbonDisplayRule(
        legacyContext({
          ribbonEditorState: {
            queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
              patches = queuedPatches;
            },
          },
          ribbonExplorer: {
            refresh: () => undefined,
          },
        } as any),
        new RibbonDocumentNode(document),
      );

      const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
        sourceId: "source",
        fileUri: "/tmp/RibbonDiffXml.xml",
        kind: "Application",
      });
      const step = updatedDocument.views[0].displayRules[0].steps[0];

      assert.strictEqual(step.kind, item.expectedKind);
      if (item.expectedSetting) {
        assert.strictEqual(
          step.kind === "OrganizationSettingRule" ? step.setting : undefined,
          item.expectedSetting,
        );
      }
      if (item.expectedAddress) {
        assert.strictEqual(
          step.kind === "PageRule" ? step.address : undefined,
          item.expectedAddress,
        );
      }
    }
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }
});

test("adds a nested child rule step from prompts", async () => {
  const source = `<RibbonDiffXml>
  <RuleDefinitions>
    <DisplayRules>
      <DisplayRule Id="new.Display">
        <OrRule />
      </DisplayRule>
    </DisplayRules>
  </RuleDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const orRule = document.views[0].displayRules[0].steps[0];
  let patches: RibbonPatch[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  (vscode.window as any).showQuickPick = async (
    picks: vscode.QuickPickItem[] | string[],
    options: { placeHolder?: string },
  ) => {
    const label = new Map([
      ["First rule step", "FormStateRule"],
      ["Form state", "Create"],
      ["Invert result?", "No"],
    ]).get(options.placeHolder ?? "");
    return typeof picks[0] === "string"
      ? label
      : (picks as vscode.QuickPickItem[]).find((pick) => pick.label === label);
  };

  try {
    await addRibbonRuleChildStep(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonItemNode(
        "1. OrRule",
        undefined,
        "d365RibbonRuleStep:OrRule",
        "symbol-property",
        [],
        [],
        {
          document,
          range: orRule.range,
        },
      ),
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
  }

  const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const updatedOrRule = updatedDocument.views[0].displayRules[0].steps[0];

  assert.strictEqual(updatedOrRule.kind, "OrRule");
  assert.strictEqual(
    updatedOrRule.kind === "OrRule" && updatedOrRule.children[0].kind === "FormStateRule"
      ? updatedOrRule.children[0].state
      : undefined,
    "Create",
  );
});

test("edits a nested child rule step", async () => {
  const source = `<RibbonDiffXml>
  <RuleDefinitions>
    <DisplayRules>
      <DisplayRule Id="new.Display">
        <OrRule>
          <FormStateRule State="Create" />
        </OrRule>
      </DisplayRule>
    </DisplayRules>
  </RuleDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const orRule = document.views[0].displayRules[0].steps[0];
  assert.strictEqual(orRule.kind, "OrRule");
  const child = orRule.children[0];
  let patches: RibbonPatch[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  (vscode.window as any).showQuickPick = async (
    picks: vscode.QuickPickItem[] | string[],
    options: { placeHolder?: string },
  ) => {
    const label = new Map([
      ["First rule step", "FormStateRule"],
      ["Form state", "Existing"],
      ["Invert result?", "No"],
    ]).get(options.placeHolder ?? "");
    return typeof picks[0] === "string"
      ? label
      : (picks as vscode.QuickPickItem[]).find((pick) => pick.label === label);
  };

  try {
    await editRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonItemNode(
        "1. FormStateRule",
        "Create",
        "d365RibbonRuleStep:FormStateRule",
        "symbol-property",
        [],
        [],
        { document, range: child.range },
      ),
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
  }

  const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const updatedOrRule = updatedDocument.views[0].displayRules[0].steps[0];

  assert.strictEqual(
    updatedOrRule.kind === "OrRule" && updatedOrRule.children[0].kind === "FormStateRule"
      ? updatedOrRule.children[0].state
      : undefined,
    "Existing",
  );
});

test("deletes a nested child rule step", async () => {
  const source = `<RibbonDiffXml>
  <RuleDefinitions>
    <DisplayRules>
      <DisplayRule Id="new.Display">
        <OrRule>
          <FormStateRule State="Create" />
          <FormStateRule State="Existing" />
        </OrRule>
      </DisplayRule>
    </DisplayRules>
  </RuleDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const orRule = document.views[0].displayRules[0].steps[0];
  assert.strictEqual(orRule.kind, "OrRule");
  let patches: RibbonPatch[] = [];
  const originalShowWarningMessage = vscode.window.showWarningMessage;

  (vscode.window as any).showWarningMessage = async (
    _message: string,
    _options: { detail?: string },
    action: string,
  ) => action;

  try {
    await deleteRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
        notifications: createNotifications(),
      } as any),
      new RibbonItemNode(
        "1. FormStateRule",
        "Create",
        "d365RibbonRuleStep:FormStateRule",
        "symbol-property",
        [],
        [],
        { document, range: orRule.children[0].range },
      ),
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const updatedOrRule = updatedDocument.views[0].displayRules[0].steps[0];

  assert.deepStrictEqual(
    updatedOrRule.kind === "OrRule"
      ? updatedOrRule.children.map((step) =>
          step.kind === "FormStateRule" ? step.state : undefined,
        )
      : [],
    ["Existing"],
  );
});

test("moves nested child rule steps", async () => {
  const source = `<RibbonDiffXml>
  <RuleDefinitions>
    <DisplayRules>
      <DisplayRule Id="new.Display">
        <OrRule>
          <FormStateRule State="Create" />
          <FormStateRule State="Existing" />
        </OrRule>
      </DisplayRule>
    </DisplayRules>
  </RuleDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const orRule = document.views[0].displayRules[0].steps[0];
  assert.strictEqual(orRule.kind, "OrRule");
  let patches: RibbonPatch[] = [];

  await moveRibbonNodeUp(
    legacyContext({
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
    } as any),
    new RibbonItemNode(
      "2. FormStateRule",
      "Existing",
      "d365RibbonRuleStep:FormStateRule",
      "symbol-property",
      [],
      [],
      { document, range: orRule.children[1].range },
    ),
  );

  const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const updatedOrRule = updatedDocument.views[0].displayRules[0].steps[0];

  assert.deepStrictEqual(
    updatedOrRule.kind === "OrRule"
      ? updatedOrRule.children.map((step) =>
          step.kind === "FormStateRule" ? step.state : undefined,
        )
      : [],
    ["Existing", "Create"],
  );
});

test("creates selection count enable rule conditions from prompts", async () => {
  const source = `<RibbonDiffXml>
  <RuleDefinitions />
</RibbonDiffXml>`;
  const cases = [
    {
      condition: "Equal to",
      inputs: new Map([
        ["Enable rule id", "new.SelectionCount.Equal"],
        ["Selected rows", "1"],
      ]),
      expectedMinimum: 1,
      expectedMaximum: 1,
    },
    {
      condition: "Greater than",
      inputs: new Map([
        ["Enable rule id", "new.SelectionCount.GreaterThan"],
        ["Selected rows", "1"],
      ]),
      expectedMinimum: 2,
      expectedMaximum: undefined,
    },
    {
      condition: "Greater than or equal",
      inputs: new Map([
        ["Enable rule id", "new.SelectionCount.GreaterThanOrEqual"],
        ["Selected rows", "1"],
      ]),
      expectedMinimum: 1,
      expectedMaximum: undefined,
    },
    {
      condition: "Less than",
      inputs: new Map([
        ["Enable rule id", "new.SelectionCount.LessThan"],
        ["Selected rows", "2"],
      ]),
      expectedMinimum: undefined,
      expectedMaximum: 1,
    },
    {
      condition: "Less than or equal",
      inputs: new Map([
        ["Enable rule id", "new.SelectionCount.LessThanOrEqual"],
        ["Selected rows", "1"],
      ]),
      expectedMinimum: undefined,
      expectedMaximum: 1,
    },
    {
      condition: "Between",
      inputs: new Map([
        ["Enable rule id", "new.SelectionCount.Between"],
        ["Minimum selected rows", "1"],
        ["Maximum selected rows", "3"],
      ]),
      expectedMinimum: 1,
      expectedMaximum: 3,
    },
  ];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  try {
    for (const item of cases) {
      const [document] = readRibbonDocuments(source, {
        sourceId: "source",
        fileUri: "/tmp/RibbonDiffXml.xml",
        kind: "Application",
      });
      let patches: RibbonPatch[] = [];
      (vscode.window as any).showQuickPick = async (
        picks: vscode.QuickPickItem[] | string[],
        options: { placeHolder?: string },
      ) => {
        const labels = new Map([
          ["First rule step", "SelectionCountRule"],
          ["Applies to", "SelectedEntity"],
          ["Selected row condition", item.condition],
          ["Invert result?", "No"],
        ]);
        const label = labels.get(options.placeHolder ?? "");
        return typeof picks[0] === "string"
          ? label
          : (picks as vscode.QuickPickItem[]).find((pick) => pick.label === label);
      };
      (vscode.window as any).showInputBox = async (options: { prompt?: string }) =>
        item.inputs.get(options.prompt ?? "");

      await addRibbonEnableRule(
        legacyContext({
          ribbonEditorState: {
            queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
              patches = queuedPatches;
            },
          },
          ribbonExplorer: {
            refresh: () => undefined,
          },
        } as any),
        new RibbonDocumentNode(document),
      );

      const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
        sourceId: "source",
        fileUri: "/tmp/RibbonDiffXml.xml",
        kind: "Application",
      });
      const step = updatedDocument.views[0].enableRules[0].steps[0];

      assert.strictEqual(step.kind, "SelectionCountRule");
      assert.strictEqual(
        step.kind === "SelectionCountRule" ? step.minimum : undefined,
        item.expectedMinimum,
      );
      assert.strictEqual(
        step.kind === "SelectionCountRule" ? step.maximum : undefined,
        item.expectedMaximum,
      );
    }
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }
});

test("does not queue patches when enable rule creation is cancelled", async () => {
  const [document] = readRibbonDocuments(
    `<RibbonDiffXml>
</RibbonDiffXml>`,
    {
      sourceId: "source",
      fileUri: "/tmp/RibbonDiffXml.xml",
      kind: "Application",
    },
  );
  let queued = false;

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;
  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) =>
    options.placeHolder === "First rule step"
      ? items.find((item) => item.label === "No step")
      : undefined;
  (vscode.window as any).showInputBox = async () => undefined;

  try {
    await addRibbonEnableRule(
      legacyContext({
        ribbonEditorState: {
          queuePatches: () => {
            queued = true;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonDocumentNode(document),
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  assert.strictEqual(queued, false);
});

test("prefills enable rule ids from the ribbon scope", async () => {
  const source = `<RibbonDiffXml>
  <RuleDefinitions>
    <EnableRules>
      <EnableRule Id="d365tools.account.Form.EnableRule" />
    </EnableRules>
  </RuleDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  let patches: RibbonPatch[] = [];
  const inputValues: string[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) =>
    options.placeHolder === "First rule step"
      ? items.find((item) => item.label === "No step")
      : undefined;
  (vscode.window as any).showInputBox = async (options: { value?: string }) => {
    inputValues.push(options.value ?? "");
    return options.value;
  };

  try {
    await addRibbonEnableRule(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonSectionNode(
        document,
        document.views.find((view) => view.scope === "Form") ?? document.views[0],
        "enableRules",
        document.views[0].enableRules.length,
      ),
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  assert.deepStrictEqual(inputValues, ["d365tools.account.Form.EnableRule.2"]);
  const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  assert.deepStrictEqual(
    updatedDocument.views[0].enableRules.map((rule) => rule.id),
    ["d365tools.account.Form.EnableRule", "d365tools.account.Form.EnableRule.2"],
  );
});

test("prefills rule ids with the selected rule step name", async () => {
  const source = `<RibbonDiffXml>
</RibbonDiffXml>`;
  const inputValues: string[] = [];
  let nextStep: "SelectionCountRule" | "FormTypeRule" = "SelectionCountRule";

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[] | string[],
    options: { placeHolder?: string },
  ) => {
    const labels = new Map([
      ["First rule step", nextStep],
      ["Applies to", "SelectedEntity"],
      ["Selected row condition", "Equal to"],
      ["Form type", "Main"],
      ["Invert result?", "No"],
    ]);
    const label = labels.get(options.placeHolder ?? "");
    return typeof items[0] === "string"
      ? label
      : (items as vscode.QuickPickItem[]).find((item) => item.label === label);
  };
  (vscode.window as any).showInputBox = async (options: { prompt?: string; value?: string }) => {
    if (options.prompt === "Selected rows") {
      return "1";
    }

    inputValues.push(options.value ?? "");
    return options.value;
  };

  try {
    const [enableDocument] = readRibbonDocuments(source, {
      sourceId: "source",
      fileUri: "/tmp/RibbonDiffXml.xml",
      kind: "Entity",
      entityLogicalName: "account",
    });
    await addRibbonEnableRule(
      legacyContext({
        ribbonEditorState: {
          queuePatches: () => undefined,
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonSectionNode(
        enableDocument,
        enableDocument.views.find((view) => view.scope === "Form") ?? enableDocument.views[0],
        "enableRules",
        enableDocument.views[0].enableRules.length,
      ),
    );

    nextStep = "FormTypeRule";
    const [displayDocument] = readRibbonDocuments(source, {
      sourceId: "source",
      fileUri: "/tmp/RibbonDiffXml.xml",
      kind: "Entity",
      entityLogicalName: "account",
    });
    await addRibbonDisplayRule(
      legacyContext({
        ribbonEditorState: {
          queuePatches: () => undefined,
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      new RibbonSectionNode(
        displayDocument,
        displayDocument.views.find((view) => view.scope === "Form") ?? displayDocument.views[0],
        "displayRules",
        displayDocument.views[0].displayRules.length,
      ),
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  assert.deepStrictEqual(inputValues, [
    "d365tools.account.Form.SelectionCountRule.EnableRule",
    "d365tools.account.Form.FormTypeRule.DisplayRule",
  ]);
});

test("prefills manual command rule reference ids from the command id", async () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.account.Form.Validate.Command" />
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const command = document.views[0].commandDefinitions[0];
  const baseContext = {
    ribbonExplorer: {
      refresh: () => undefined,
    },
  };
  const inputValues: string[] = [];
  const patchesByKind: RibbonPatch[][] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: { placeHolder?: string },
  ) =>
    items.find((item) =>
      options.placeHolder === "Enable rule"
        ? item.label === "Type enable rule id"
        : item.label === "Type display rule id",
    );
  (vscode.window as any).showInputBox = async (options: { value?: string }) => {
    inputValues.push(options.value ?? "");
    return options.value;
  };

  try {
    await addRibbonCommandEnableRuleRef(
      legacyContext({
        ...baseContext,
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patchesByKind.push(queuedPatches);
          },
        },
      } as any),
      new RibbonItemNode("EnableRules", "0", "d365RibbonEnableRuleRefs", "references", [], [], {
        document,
        range: command.range,
      }),
    );
    await addRibbonCommandDisplayRuleRef(
      legacyContext({
        ...baseContext,
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patchesByKind.push(queuedPatches);
          },
        },
      } as any),
      new RibbonItemNode("DisplayRules", "0", "d365RibbonDisplayRuleRefs", "references", [], [], {
        document,
        range: command.range,
      }),
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  assert.deepStrictEqual(inputValues, [
    "new.account.Form.Validate.EnableRule",
    "new.account.Form.Validate.DisplayRule",
  ]);
  const [updatedEnableDocument] = readRibbonDocuments(
    applyRibbonPatchSequence(source, patchesByKind[0]),
    {
      sourceId: "source",
      fileUri: "/tmp/RibbonDiffXml.xml",
      kind: "Application",
    },
  );
  const [updatedDisplayDocument] = readRibbonDocuments(
    applyRibbonPatchSequence(source, patchesByKind[1]),
    {
      sourceId: "source",
      fileUri: "/tmp/RibbonDiffXml.xml",
      kind: "Application",
    },
  );

  assert.deepStrictEqual(updatedEnableDocument.views[0].commandDefinitions[0].enableRuleRefs, [
    "new.account.Form.Validate.EnableRule",
  ]);
  assert.deepStrictEqual(updatedDisplayDocument.views[0].commandDefinitions[0].displayRuleRefs, [
    "new.account.Form.Validate.DisplayRule",
  ]);
});

test("deletes command rule references", async () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <EnableRules><EnableRule Id="new.Enabled" /></EnableRules>
      <DisplayRules><DisplayRule Id="new.Visible" /></DisplayRules>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const enableRuleRef = findXmlElement(source, "EnableRule", "new.Enabled");
  const displayRuleRef = findXmlElement(source, "DisplayRule", "new.Visible");
  let patches: RibbonPatch[] = [];
  let refreshed = false;
  const originalShowWarningMessage = vscode.window.showWarningMessage;

  (vscode.window as any).showWarningMessage = async (
    _message: string,
    _options: { detail?: string },
    action: string,
  ) => action;

  try {
    await deleteRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => {
            refreshed = true;
          },
        },
        notifications: createNotifications(),
      } as any),
      new RibbonItemNode("new.Enabled", "EnableRule", "d365RibbonRuleRef", "symbol-key", [], [], {
        document,
        range: enableRuleRef.range,
      }),
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  const withoutEnableRef = applyRibbonPatchSequence(source, patches);
  const [documentWithoutEnableRef] = readRibbonDocuments(withoutEnableRef, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.strictEqual(refreshed, true);
  assert.deepStrictEqual(
    documentWithoutEnableRef.views[0].commandDefinitions[0].enableRuleRefs,
    [],
  );
  assert.deepStrictEqual(documentWithoutEnableRef.views[0].commandDefinitions[0].displayRuleRefs, [
    "new.Visible",
  ]);

  (vscode.window as any).showWarningMessage = async (
    _message: string,
    _options: { detail?: string },
    action: string,
  ) => action;

  try {
    await deleteRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
        notifications: createNotifications(),
      } as any),
      new RibbonItemNode("new.Visible", "DisplayRule", "d365RibbonRuleRef", "symbol-key", [], [], {
        document,
        range: displayRuleRef.range,
      }),
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  const withoutDisplayRef = applyRibbonPatchSequence(source, patches);
  const [documentWithoutDisplayRef] = readRibbonDocuments(withoutDisplayRef, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.deepStrictEqual(documentWithoutDisplayRef.views[0].commandDefinitions[0].enableRuleRefs, [
    "new.Enabled",
  ]);
  assert.deepStrictEqual(
    documentWithoutDisplayRef.views[0].commandDefinitions[0].displayRuleRefs,
    [],
  );
});

test("deletes enable rule references when enable rule definitions are removed", async () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <EnableRules><EnableRule Id="new.Enabled" /><EnableRule Id="new.Other" /></EnableRules>
      <DisplayRules><DisplayRule Id="new.Visible" /></DisplayRules>
    </CommandDefinition>
    <CommandDefinition Id="new.Second">
      <EnableRules>
        <EnableRule Id="new.Enabled" />
      </EnableRules>
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions>
    <EnableRules><EnableRule Id="new.Enabled" /><EnableRule Id="new.Other" /></EnableRules>
    <DisplayRules><DisplayRule Id="new.Visible" /></DisplayRules>
  </RuleDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const enableRule = document.views[0].enableRules.find((rule) => rule.id === "new.Enabled");
  let patches: RibbonPatch[] = [];
  const originalShowWarningMessage = vscode.window.showWarningMessage;

  assert.ok(enableRule);
  (vscode.window as any).showWarningMessage = async (
    _message: string,
    _options: { detail?: string },
    action: string,
  ) => action;

  try {
    await deleteRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
        notifications: createNotifications(),
      } as any),
      new RibbonItemNode(enableRule.id, undefined, "d365RibbonEnableRule", "symbol-key", [], [], {
        document,
        range: enableRule.range,
      }),
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.deepStrictEqual(updatedDocument.views[0].commandDefinitions[0].enableRuleRefs, [
    "new.Other",
  ]);
  assert.deepStrictEqual(updatedDocument.views[0].commandDefinitions[1].enableRuleRefs, []);
  assert.deepStrictEqual(updatedDocument.views[0].commandDefinitions[0].displayRuleRefs, [
    "new.Visible",
  ]);
  assert.deepStrictEqual(
    updatedDocument.views[0].enableRules.map((rule) => rule.id),
    ["new.Other"],
  );
});

test("deletes display rule references when display rule definitions are removed", async () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <EnableRules><EnableRule Id="new.Enabled" /></EnableRules>
      <DisplayRules><DisplayRule Id="new.Visible" /><DisplayRule Id="new.OtherVisible" /></DisplayRules>
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions>
    <EnableRules><EnableRule Id="new.Enabled" /></EnableRules>
    <DisplayRules><DisplayRule Id="new.Visible" /><DisplayRule Id="new.OtherVisible" /></DisplayRules>
  </RuleDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const displayRule = document.views[0].displayRules.find((rule) => rule.id === "new.Visible");
  let patches: RibbonPatch[] = [];
  const originalShowWarningMessage = vscode.window.showWarningMessage;

  assert.ok(displayRule);
  (vscode.window as any).showWarningMessage = async (
    _message: string,
    _options: { detail?: string },
    action: string,
  ) => action;

  try {
    await deleteRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
        notifications: createNotifications(),
      } as any),
      new RibbonItemNode(displayRule.id, undefined, "d365RibbonDisplayRule", "eye", [], [], {
        document,
        range: displayRule.range,
      }),
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  const [updatedDocument] = readRibbonDocuments(applyRibbonPatchSequence(source, patches), {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.deepStrictEqual(updatedDocument.views[0].commandDefinitions[0].enableRuleRefs, [
    "new.Enabled",
  ]);
  assert.deepStrictEqual(updatedDocument.views[0].commandDefinitions[0].displayRuleRefs, [
    "new.OtherVisible",
  ]);
  assert.deepStrictEqual(
    updatedDocument.views[0].displayRules.map((rule) => rule.id),
    ["new.OtherVisible"],
  );
});

test("deletes hide action after confirmation", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <HideCustomAction HideActionId="new.Hide.Save" Location="Mscrm.Form.account.Save" />
  </CustomActions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const hideAction = document.views[0].hideActions[0];
  let patches: RibbonPatch[] = [];
  let refreshed = false;
  let warningMessage = "";
  let warningDetail = "";
  const originalShowWarningMessage = vscode.window.showWarningMessage;

  (vscode.window as any).showWarningMessage = async (
    message: string,
    options: { detail?: string },
    action: string,
  ) => {
    warningMessage = message;
    warningDetail = options.detail ?? "";
    return action;
  };

  try {
    await deleteRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => {
            refreshed = true;
          },
        },
        notifications: createNotifications(),
      } as any),
      new RibbonItemNode(
        hideAction.hideActionId,
        undefined,
        "d365RibbonHideAction",
        "eye-closed",
        [],
        [],
        { document, range: hideAction.range },
      ),
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.strictEqual(refreshed, true);
  assert.strictEqual(warningMessage, "Delete hide action new.Hide.Save?");
  assert.strictEqual(warningDetail, "This removes the HideCustomAction XML from the ribbon.");
  assert.deepStrictEqual(updatedDocument.views[0].hideActions, []);
});

test("keeps hide action when delete confirmation is canceled", async () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <HideCustomAction HideActionId="new.Hide.Save" Location="Mscrm.Form.account.Save" />
  </CustomActions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const hideAction = document.views[0].hideActions[0];
  let queued = false;
  let refreshed = false;
  const originalShowWarningMessage = vscode.window.showWarningMessage;

  (vscode.window as any).showWarningMessage = async () => undefined;

  try {
    await deleteRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: () => {
            queued = true;
          },
        },
        ribbonExplorer: {
          refresh: () => {
            refreshed = true;
          },
        },
        notifications: createNotifications(),
      } as any),
      new RibbonItemNode(
        hideAction.hideActionId,
        undefined,
        "d365RibbonHideAction",
        "eye-closed",
        [],
        [],
        { document, range: hideAction.range },
      ),
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  assert.strictEqual(queued, false);
  assert.strictEqual(refreshed, false);
});

test("deletes action parameters after confirmation", async () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <Actions>
        <Url Address="https://www.contoso.com">
          <CrmParameter Name="recordId" Value="FirstPrimaryItemId" />
          <StringParameter Name="data" Value="string1" />
        </Url>
        <JavaScriptFunction Library="$webresource:new_/scripts/account.js" FunctionName="run">
          <CrmParameter Value="PrimaryControl" />
          <StringParameter Value="string1" />
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
  const actions = document.views[0].commandDefinitions[0].actions;
  const urlAction = actions[0];
  const jsAction = actions[1];
  assert.strictEqual(urlAction.kind, "Url");
  assert.strictEqual(jsAction.kind, "JavaScriptFunction");
  const urlParameter = urlAction.parameters[0];
  const jsParameter = jsAction.parameters[1];
  assert.ok(urlParameter.range);
  assert.ok(jsParameter.range);

  let patches: RibbonPatch[] = [];
  let refreshed = false;
  const warningMessages: string[] = [];
  const originalShowWarningMessage = vscode.window.showWarningMessage;

  (vscode.window as any).showWarningMessage = async (message: string) => {
    warningMessages.push(message);
    return "Delete Parameter";
  };

  try {
    await deleteRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => {
            refreshed = true;
          },
        },
        notifications: createNotifications(),
      } as any),
      new RibbonItemNode(
        `1. ${urlParameter.value}`,
        urlParameter.kind,
        "d365RibbonParameter",
        "symbol-parameter",
        [],
        [],
        { document, range: urlParameter.range },
      ),
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  const withoutUrlParameter = applyRibbonPatchSequence(source, patches);
  const [documentWithoutUrlParameter] = readRibbonDocuments(withoutUrlParameter, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const updatedUrlAction = documentWithoutUrlParameter.views[0].commandDefinitions[0].actions[0];

  assert.strictEqual(refreshed, true);
  assert.deepStrictEqual(warningMessages, ["Delete parameter 1. FirstPrimaryItemId?"]);
  assert.deepStrictEqual(
    updatedUrlAction.kind === "Url"
      ? updatedUrlAction.parameters.map((parameter) => parameter.value)
      : [],
    ["string1"],
  );

  refreshed = false;
  patches = [];
  warningMessages.length = 0;
  (vscode.window as any).showWarningMessage = async (message: string) => {
    warningMessages.push(message);
    return "Delete Parameter";
  };

  try {
    await deleteRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => {
            refreshed = true;
          },
        },
        notifications: createNotifications(),
      } as any),
      new RibbonItemNode(
        `2. ${jsParameter.value}`,
        jsParameter.kind,
        "d365RibbonParameter",
        "symbol-parameter",
        [],
        [],
        { document, range: jsParameter.range },
      ),
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  const withoutJsParameter = applyRibbonPatchSequence(source, patches);
  const [documentWithoutJsParameter] = readRibbonDocuments(withoutJsParameter, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const updatedJsAction = documentWithoutJsParameter.views[0].commandDefinitions[0].actions[1];

  assert.strictEqual(refreshed, true);
  assert.deepStrictEqual(warningMessages, ["Delete parameter 2. string1?"]);
  assert.deepStrictEqual(
    updatedJsAction.kind === "JavaScriptFunction"
      ? updatedJsAction.parameters.map((parameter) => parameter.value)
      : [],
    ["PrimaryControl"],
  );
});

test("adds loc label title from language list", async () => {
  const source = `<RibbonDiffXml>
  <LocLabels>
    <LocLabel Id="new.Label"><Titles><Title languagecode="1033" description="Run" /></Titles></LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const label = document.views[0].locLabels[0];
  const node = new RibbonItemNode(
    label.id,
    undefined,
    "d365RibbonLocLabel",
    "symbol-string",
    [],
    [],
    { document, range: label.range },
  );
  let patches: RibbonPatch[] = [];
  let languageItems: vscode.QuickPickItem[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: any[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Language") {
      languageItems = items;
      return items.find((item) => item.languageCode === 1058);
    }

    return undefined;
  };
  (vscode.window as any).showInputBox = async (options: { prompt?: string }) =>
    options.prompt === "Text" ? "Run UA" : undefined;

  try {
    await addRibbonLocLabelTitle(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  assert.strictEqual(
    languageItems.some((item: any) => item.languageCode === 1033),
    false,
  );

  const updated = applyRibbonPatchSequence(source, patches);
  assert.match(updated, /<Title languagecode="1058" description="Run UA" \/>/);
});

test("adds loc label title from selected language title", async () => {
  const source = `<RibbonDiffXml>
  <LocLabels>
    <LocLabel Id="new.Label"><Titles><Title languagecode="1033" description="Run" /></Titles></LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const title = document.views[0].locLabels[0].titles[0];
  const node = new RibbonItemNode(
    String(title.languageCode),
    title.description,
    "d365RibbonLocLabelTitle",
    "symbol-string",
    [],
    [],
    { document, range: title.range },
  );
  let patches: RibbonPatch[] = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: any[],
    options: { placeHolder?: string },
  ) => {
    if (options.placeHolder === "Language") {
      assert.strictEqual(
        items.some((item) => item.languageCode === 1033),
        false,
      );
      return items.find((item) => item.languageCode === 1058);
    }

    return undefined;
  };
  (vscode.window as any).showInputBox = async (options: { prompt?: string }) =>
    options.prompt === "Text" ? "Run UA" : undefined;

  try {
    await addRibbonLocLabelTitle(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInputBox = originalShowInputBox;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  assert.match(updated, /<Title languagecode="1058" description="Run UA" \/>/);
});

test("deletes loc label title after confirmation", async () => {
  const source = `<RibbonDiffXml>
  <LocLabels>
    <LocLabel Id="new.Label">
      <Titles>
        <Title languagecode="1033" description="Run" />
        <Title languagecode="1026" description="Run BG" />
      </Titles>
    </LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const title = document.views[0].locLabels[0].titles[1];
  let patches: RibbonPatch[] = [];
  let refreshed = false;
  let warningMessage = "";
  let warningDetail = "";
  const originalShowWarningMessage = vscode.window.showWarningMessage;

  (vscode.window as any).showWarningMessage = async (
    message: string,
    options: { detail?: string },
    action: string,
  ) => {
    warningMessage = message;
    warningDetail = options.detail ?? "";
    return action;
  };

  try {
    await deleteRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => {
            refreshed = true;
          },
        },
        notifications: createNotifications(),
      } as any),
      new RibbonItemNode(
        String(title.languageCode),
        title.description,
        "d365RibbonLocLabelTitle",
        "symbol-string",
        [],
        [],
        { document, range: title.range },
      ),
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  const updated = applyRibbonPatchSequence(source, patches);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.strictEqual(refreshed, true);
  assert.strictEqual(warningMessage, "Delete Loc label language 1026 from new.Label?");
  assert.strictEqual(warningDetail, "This removes this language title from the LocLabel.");
  assert.deepStrictEqual(
    updatedDocument.views[0].locLabels[0].titles.map((item) => item.languageCode),
    [1033],
  );
});

test("keeps loc label title when delete confirmation is canceled", async () => {
  const source = `<RibbonDiffXml>
  <LocLabels>
    <LocLabel Id="new.Label"><Titles><Title languagecode="1033" description="Run" /></Titles></LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const title = document.views[0].locLabels[0].titles[0];
  let queued = false;
  let refreshed = false;
  const originalShowWarningMessage = vscode.window.showWarningMessage;

  (vscode.window as any).showWarningMessage = async () => undefined;

  try {
    await deleteRibbonNode(
      legacyContext({
        ribbonEditorState: {
          queuePatches: () => {
            queued = true;
          },
        },
        ribbonExplorer: {
          refresh: () => {
            refreshed = true;
          },
        },
        notifications: createNotifications(),
      } as any),
      new RibbonItemNode(
        String(title.languageCode),
        title.description,
        "d365RibbonLocLabelTitle",
        "symbol-string",
        [],
        [],
        { document, range: title.range },
      ),
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  assert.strictEqual(queued, false);
  assert.strictEqual(refreshed, false);
});

test("plans cascade delete for ribbon items with one reference", () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.Action" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.Button" Command="new.Command" LabelText="$LocLabels:new.Label" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <EnableRules><EnableRule Id="new.Enabled" /></EnableRules>
      <DisplayRules><DisplayRule Id="new.Visible" /></DisplayRules>
      <Actions><Url Address="https://contoso.example" /></Actions>
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions>
    <EnableRules><EnableRule Id="new.Enabled" /></EnableRules>
    <DisplayRules><DisplayRule Id="new.Visible" /></DisplayRules>
  </RuleDefinitions>
  <LocLabels>
    <LocLabel Id="new.Label"><Titles><Title languagecode="1033" description="Run" /></Titles></LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const action = document.views[0].customActions[0];

  const plan = createRibbonCascadeDeletePlan(document, "d365RibbonCustomAction", action.range);

  assert.deepStrictEqual(
    plan?.related.map((item) => `${item.kind}:${item.id}`),
    [
      "CommandDefinition:new.Command",
      "EnableRule:new.Enabled",
      "DisplayRule:new.Visible",
      "LocLabel:new.Label",
    ],
  );
});

test("plans cascade delete from loc label to its single custom action", () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.Action" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.Button" Command="new.Command" LabelText="$LocLabels:new.Label" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <Actions><Url Address="https://contoso.example" /></Actions>
    </CommandDefinition>
  </CommandDefinitions>
  <LocLabels>
    <LocLabel Id="new.Label"><Titles><Title languagecode="1033" description="Run" /></Titles></LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const label = document.views[0].locLabels[0];

  const plan = createRibbonCascadeDeletePlan(document, "d365RibbonLocLabel", label.range);

  assert.deepStrictEqual(
    plan?.related.map((item) => `${item.kind}:${item.id}`),
    ["CustomAction:new.Action", "CommandDefinition:new.Command"],
  );
});

test("does not cascade delete shared ribbon items", () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.First.Action" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.First.Button" Command="new.Command" LabelText="$LocLabels:new.Label" />
      </CommandUIDefinition>
    </CustomAction>
    <CustomAction Id="new.Second.Action" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.Second.Button" Command="new.Command" LabelText="$LocLabels:new.Label" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <Actions><Url Address="https://contoso.example" /></Actions>
    </CommandDefinition>
  </CommandDefinitions>
  <LocLabels>
    <LocLabel Id="new.Label"><Titles><Title languagecode="1033" description="Run" /></Titles></LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const action = document.views[0].customActions[0];
  const label = document.views[0].locLabels[0];

  const plan = createRibbonCascadeDeletePlan(document, "d365RibbonCustomAction", action.range);
  const labelPlan = createRibbonCascadeDeletePlan(document, "d365RibbonLocLabel", label.range);

  assert.deepStrictEqual(plan?.related, []);
  assert.deepStrictEqual(labelPlan?.related, []);
});

test("delete command can remove related items and undo restores them", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-cascade-delete-"));
  const filePath = path.join(workspaceRoot, "RibbonDiffXml.xml");
  await fs.writeFile(
    filePath,
    `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.Action" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.Button" Command="new.Command" LabelText="$LocLabels:new.Label" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <Actions><Url Address="https://contoso.example" /></Actions>
    </CommandDefinition>
  </CommandDefinitions>
  <LocLabels>
    <LocLabel Id="new.Label"><Titles><Title languagecode="1033" description="Run" /></Titles></LocLabel>
  </LocLabels>
</RibbonDiffXml>`,
    "utf8",
  );
  const source: RibbonSource = {
    id: "source",
    kind: "flat",
    name: "Source",
    rootUri: workspaceRoot,
    files: [{ fileUri: filePath, kind: "Entity", entityLogicalName: "account" }],
  };
  const state = new RibbonEditorState(new RibbonRepository());
  const [document] = await state.loadSource(source);
  const action = document.views[0].customActions[0];
  const node = new RibbonItemNode(
    action.id,
    undefined,
    "d365RibbonCustomAction",
    "symbol-method",
    [],
    [],
    { document, range: action.range },
  );
  const originalShowWarningMessage = vscode.window.showWarningMessage;
  let warningDetail = "";

  (vscode.window as any).showWarningMessage = async (
    _message: string,
    options: { detail?: string },
  ) => {
    warningDetail = options.detail ?? "";
    return "Delete Related Items";
  };

  try {
    await deleteRibbonNode(
      legacyContext({
        ribbonEditorState: state,
        ribbonExplorer: {
          refresh: () => undefined,
        },
        notifications: createNotifications(),
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  }

  assert.match(warningDetail, /Command definition: new\.Command/);
  assert.match(warningDetail, /Loc label: new\.Label/);

  const [deletedDocument] = await state.loadSource(source);
  assert.deepStrictEqual(deletedDocument.views[0].customActions, []);
  assert.deepStrictEqual(deletedDocument.views[0].commandDefinitions, []);
  assert.deepStrictEqual(deletedDocument.views[0].locLabels, []);

  assert.strictEqual(state.undo(), true);

  const [restoredDocument] = await state.loadSource(source);
  assert.deepStrictEqual(
    restoredDocument.views[0].customActions.map((item) => item.id),
    ["new.Action"],
  );
  assert.deepStrictEqual(
    restoredDocument.views[0].commandDefinitions.map((item) => item.id),
    ["new.Command"],
  );
  assert.deepStrictEqual(
    restoredDocument.views[0].locLabels.map((item) => item.id),
    ["new.Label"],
  );
});

test("lists each bound JavaScript web resource once", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-js-pick-"));

  const picks = await listBoundJavaScriptLibraries(
    legacyContext({
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
    } as any),
  );

  assert.deepStrictEqual(
    picks.map((pick) => pick.uniqueName),
    ["new_/account/form-copy.js", "new_/account/form.js"],
  );
});

test("lists image web resources from an environment", async () => {
  const requestedUrls: string[] = [];
  const picks = await listEnvironmentImageWebResources({
    get: async <T>(url: string): Promise<T> => {
      requestedUrls.push(url);
      if (requestedUrls.length === 1) {
        return {
          value: [
            {
              name: "new_\\account\\image32x32.png",
              displayname: "Account icon",
              webresourcetype: 5,
            },
            { name: "new_/account/image32x32.png", webresourcetype: 5 },
            { name: "new_/account/icon.ico", webresourcetype: 10 },
            { name: "new_/account/image.svg", webresourcetype: 12 },
            { name: "new_/Loc/account.1033.resx", webresourcetype: 12 },
            { name: "new_/scripts/account.js", webresourcetype: 3 },
          ],
          "@odata.nextLink": "/webresourceset?page=2",
        } as T;
      }

      return {
        value: [{ name: "new_/account/image16x16.png", webresourcetype: 5 }],
      } as T;
    },
  });

  assert.doesNotMatch(decodeURIComponent(requestedUrls[0]), /\$filter=.*webresourcetype/);
  assert.doesNotMatch(decodeURIComponent(requestedUrls[0]), /\$top=/);
  assert.strictEqual(requestedUrls[1], "/webresourceset?page=2");
  assert.deepStrictEqual(
    picks.map((pick) => [pick.uniqueName, pick.description]),
    [
      ["new_/account/icon.ico", "ICO"],
      ["new_/account/image.svg", "SVG"],
      ["new_/account/image16x16.png", "PNG"],
      ["new_/account/image32x32.png", "Account icon"],
    ],
  );
});

test("searches environment image web resources by typed text", async () => {
  const requestedUrls: string[] = [];
  const picks = await listEnvironmentImageWebResources(
    {
      get: async <T>(url: string): Promise<T> => {
        requestedUrls.push(url);
        return {
          value: [
            {
              name: "msdyn_/ext60/themes/classic_theme/images/btn/btn_default_medium_over_sides.gif",
              webresourcetype: 7,
            },
            { name: "new_/Loc/msdyn_label.1033.resx", webresourcetype: 12 },
          ],
        } as T;
      },
    },
    "msdyn",
  );

  const firstUrl = decodeURIComponent(requestedUrls[0]);
  assert.match(firstUrl, /\$filter=contains\(name,'msdyn'\)/);
  assert.doesNotMatch(firstUrl, /\$top=/);
  assert.deepStrictEqual(
    picks.map((pick) => [pick.uniqueName, pick.description]),
    [["msdyn_/ext60/themes/classic_theme/images/btn/btn_default_medium_over_sides.gif", "GIF"]],
  );
});

test("does not query environment image web resources before two characters", async () => {
  let called = false;
  const picks = await listEnvironmentImageWebResources(
    {
      get: async <T>(): Promise<T> => {
        called = true;
        return { value: [] } as T;
      },
    },
    "m",
  );

  assert.strictEqual(called, false);
  assert.deepStrictEqual(picks, []);
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
  const quickPickOptions: Array<{ ignoreFocusOut?: boolean }> = [];
  const inputOptions: Array<{ ignoreFocusOut?: boolean }> = [];

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInputBox = vscode.window.showInputBox;

  (vscode.window as any).showQuickPick = async (
    items: any[],
    options: { placeHolder?: string; ignoreFocusOut?: boolean },
  ) => {
    quickPickOptions.push(options);

    if (options.placeHolder === "Command action") {
      actionKindItems = items;
      return items.find((item) => item.label === "JavaScript function");
    }

    if (options.placeHolder === "JavaScript web resource") {
      libraryItems = items;
      return items[0];
    }

    if (options.placeHolder === "JavaScript function name") {
      return items.find((item) => item.label === "Type function name");
    }

    if (options.placeHolder === "CRM parameters") {
      parameterItems = items;
      return items.filter((item) => item.picked);
    }

    return undefined;
  };
  (vscode.window as any).showInputBox = async (options: {
    prompt?: string;
    value?: string;
    ignoreFocusOut?: boolean;
  }) => {
    inputOptions.push(options);

    if (options.prompt === "JavaScript function name") {
      functionInputValue = options.value;
      return options.value;
    }

    return undefined;
  };

  try {
    await editRibbonNode(
      legacyContext({
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
      } as any),
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
  assert.ok(quickPickOptions.length > 0);
  assert.ok(quickPickOptions.every((options) => options.ignoreFocusOut));
  assert.ok(inputOptions.length > 0);
  assert.ok(inputOptions.every((options) => options.ignoreFocusOut));

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
  const workspaceRoot = "/workspace/d365-ribbon-js-namespace";
  const files = new MemoryWorkspaceFiles(workspaceRoot);
  const localPath = path.join(workspaceRoot, "src/account/ribbon.js");
  files.addFile(
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
      legacyContext({
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
        files,
        ribbonEditorState: {
          queuePatches: (_document: unknown, queuedPatches: RibbonPatch[]) => {
            patches = queuedPatches;
          },
        },
        ribbonExplorer: {
          refresh: () => undefined,
        },
      } as any),
      node,
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
  }

  assert.deepStrictEqual(
    functionItems.map((item) => item.label),
    [
      "Hjk.Account.Ribbon.onButtonClick",
      "isNaN",
      "Hjk.Account.Ribbon.buttonVisible",
      "Type function name",
    ],
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
  let exportProgressCancellable: boolean | undefined;
  let exportTokenPassed = false;

  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  const originalShowSaveDialog = vscode.window.showSaveDialog;
  const originalWithProgress = vscode.window.withProgress;

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
  (vscode.window as any).withProgress = async (options: any, task: any) => {
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => undefined }),
    };
    if (String(options.title).startsWith("Exporting ")) {
      exportProgressCancellable = options.cancellable;
    }
    return task({ report: () => undefined }, token);
  };

  try {
    await openRibbonsFromSolution(
      legacyContext({
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
          createClient: async (env: any) =>
            new DataverseClient({
              env,
              apiRoot: "https://org.crm.dynamics.com/api/data/v9.2",
              token: "token",
            }),
        },
        solutionZipService: {
          listUnmanagedSolutions: async () => [
            { uniqueName: "core", friendlyName: "Core", version: "1.0.0" },
          ],
          downloadSolutionZip: async (_client: unknown, _uniqueName: string, token: unknown) => {
            exportTokenPassed = Boolean(token);
            return buffer;
          },
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
        notifications: createNotifications(),
      } as any),
    );
  } finally {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
    (vscode.window as any).showSaveDialog = originalShowSaveDialog;
    (vscode.window as any).withProgress = originalWithProgress;
  }

  assert.strictEqual(exportProgressCancellable, true);
  assert.strictEqual(exportTokenPassed, true);
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
      legacyContext({
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
          createClient: async (env: any) =>
            new DataverseClient({
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
        notifications: createNotifications(),
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
      } as any),
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
    legacyContext({
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
    } as any),
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
    legacyContext({
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
    } as any),
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
  const ctx = legacyContext({
    configuration: { workspaceRoot },
    ribbonSourceLocator: { locate: async () => [source] },
    ribbonEditorState: state,
    ribbonExplorer: { refresh: () => undefined },
  } as any);

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
  const ctx = legacyContext({
    configuration: { workspaceRoot },
    ribbonSourceLocator: { locate: async () => [source] },
    ribbonEditorState: state,
    ribbonExplorer: { refresh: () => undefined },
  } as any);

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

function findXmlElement(source: string, name: string, id: string): XmlElementRange {
  const element = collectXmlElements(scanXmlElements(source)).find(
    (item) =>
      item.name === name &&
      item.attributes.some((attribute) => attribute.name === "Id" && attribute.value === id),
  );

  assert.ok(element);
  return element;
}

function collectXmlElements(elements: XmlElementRange[]): XmlElementRange[] {
  return elements.flatMap((element) => [element, ...collectXmlElements(element.children)]);
}
