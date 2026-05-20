import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { RibbonDocument } from "../models";
import { RibbonDocumentNode, RibbonItemNode } from "../ribbonExplorer";
import { RibbonFormPanel } from "../webview/ribbonFormPanel";

test("renders selected ribbon document details in a read-only webview", () => {
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
