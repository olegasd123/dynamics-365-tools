import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { RibbonDocument } from "../models";
import { RibbonDocumentNode, RibbonItemNode, RibbonSectionNode } from "../ribbonExplorer";
import { RibbonFormPanel } from "../webview/ribbonFormPanel";

test("renders selected ribbon document details with edit actions", () => {
  const formPanel = new RibbonFormPanel();
  const document: RibbonDocument = {
    id: "doc",
    sourceId: "source",
    kind: "Entity",
    entityLogicalName: "account",
    fileUri: "/tmp/RibbonDiffXml.xml",
    sourceText: "<RibbonDiffXml />",
    ribbonRange: { start: 0, end: 17 },
    sections: {},
    views: [
      {
        scope: "Form",
        customActions: [],
        hideActions: [],
        commandDefinitions: [],
        enableRules: [],
        displayRules: [],
        locLabels: [],
        unknownNodeRanges: [],
      },
    ],
  };

  formPanel.show(new RibbonDocumentNode(document));

  const panel = (vscode.window as any).__lastWebviewPanel;
  assert.strictEqual(panel.title, "Ribbon Document");
  assert.match(panel.webview.html, /account/);
  assert.match(panel.webview.html, /RibbonDiffXml\.xml/);
  assert.doesNotMatch(panel.webview.html, /Open XML/);
  assert.match(panel.webview.html, /Save/);
  formPanel.dispose();
});

test("does not render custom button actions for ribbon sections", () => {
  const formPanel = new RibbonFormPanel();
  const document: RibbonDocument = {
    id: "doc",
    sourceId: "source",
    kind: "Entity",
    entityLogicalName: "account",
    fileUri: "/tmp/RibbonDiffXml.xml",
    sourceText: "<RibbonDiffXml />",
    ribbonRange: { start: 0, end: 17 },
    sections: {},
    views: [
      {
        scope: "Form",
        customActions: [],
        hideActions: [],
        commandDefinitions: [],
        enableRules: [],
        displayRules: [],
        locLabels: [],
        unknownNodeRanges: [],
      },
    ],
  };
  const [view] = document.views;

  formPanel.show(new RibbonSectionNode(document, view, "hideActions", 0));

  const panel = (vscode.window as any).__lastWebviewPanel;
  assert.doesNotMatch(panel.webview.html, /Add Button/);
  assert.doesNotMatch(panel.webview.html, /Hide OOB/);
  formPanel.dispose();
});

test("escapes item detail values before rendering", () => {
  const formPanel = new RibbonFormPanel();
  const node = new RibbonItemNode(
    "Unsafe <Label>",
    undefined,
    "d365RibbonCustomAction",
    "symbol-method",
    [["Id", `new.account."bad"`]],
  );

  formPanel.show(node);

  const panel = (vscode.window as any).__lastWebviewPanel;
  assert.match(panel.webview.html, /Unsafe &lt;Label&gt;/);
  assert.match(panel.webview.html, /new\.account\.&quot;bad&quot;/);
  formPanel.dispose();
});

test("renders list detail values as lists", () => {
  const formPanel = new RibbonFormPanel();
  const node = new RibbonItemNode(
    "JavaScript: run",
    undefined,
    "d365RibbonJavaScriptAction",
    "symbol-function",
    [["Parameters", ["PrimaryControl", "SelectedControl"]]],
  );

  formPanel.show(node);

  const panel = (vscode.window as any).__lastWebviewPanel;
  assert.match(panel.webview.html, /<ul>/);
  assert.match(panel.webview.html, /<li><code>PrimaryControl<\/code><\/li>/);
  assert.match(panel.webview.html, /<li><code>SelectedControl<\/code><\/li>/);
  formPanel.dispose();
});

test("runs selected node commands from the webview", async () => {
  const formPanel = new RibbonFormPanel();
  const node = new RibbonItemNode(
    "Custom action",
    undefined,
    "d365RibbonCustomAction",
    "symbol-method",
    [["Id", "new.account.CustomAction"]],
  );
  const previousExecuteCommand = vscode.commands.executeCommand;
  const calls: Array<{ command: string; argument: unknown }> = [];

  (vscode.commands as any).executeCommand = async (command: string, argument: unknown) => {
    calls.push({ command, argument });
  };

  try {
    formPanel.show(node);

    const panel = (vscode.window as any).__lastWebviewPanel;
    panel.webview.__postMessage({
      type: "runCommand",
      command: "dynamics365Tools.ribbons.editNode",
    });

    assert.deepStrictEqual(calls, [
      { command: "dynamics365Tools.ribbons.editNode", argument: node },
    ]);
  } finally {
    (vscode.commands as any).executeCommand = previousExecuteCommand;
    formPanel.dispose();
  }
});
