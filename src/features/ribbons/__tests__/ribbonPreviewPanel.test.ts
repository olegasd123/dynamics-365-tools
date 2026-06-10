import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { RibbonDocument } from "../models";
import { RibbonSectionNode, RibbonViewNode } from "../ribbonExplorer";
import { RibbonPreviewPanel } from "../webview/ribbonPreviewPanel";

const range = { start: 0, end: 1 };

function documentWith(): RibbonDocument {
  return {
    id: "doc",
    sourceId: "source",
    kind: "Entity",
    entityLogicalName: "account",
    fileUri: "/tmp/RibbonDiffXml.xml",
    sourceText: "<RibbonDiffXml />",
    ribbonRange: range,
    sections: {},
    views: [
      {
        scope: "Form",
        customActions: [
          {
            id: "ca",
            location: "Mscrm.Form.account.MainTab.Save.Controls._children",
            sequence: 10,
            commandUI: {
              kind: "Button",
              id: "btn",
              command: "new.cmd",
              labelText: "Approve",
              range,
            },
            range,
          },
        ],
        hideActions: [],
        commandDefinitions: [],
        enableRules: [],
        displayRules: [],
        locLabels: [],
        unknownNodeRanges: [],
      },
    ],
  };
}

test("renders a command bar preview for a ribbon view", () => {
  const panel = new RibbonPreviewPanel();
  const document = documentWith();
  const [view] = document.views;

  const shown = panel.show(new RibbonViewNode(document, view));

  assert.strictEqual(shown, true);
  const rendered = (vscode.window as any).__lastWebviewPanel;
  assert.strictEqual(rendered.title, "Ribbon Preview — Form");
  assert.match(rendered.webview.html, /Approve/);
  assert.match(rendered.webview.html, /MainTab › Save/);
  panel.dispose();
});

test("renders an empty state when a view has no buttons", () => {
  const panel = new RibbonPreviewPanel();
  const document = documentWith();
  document.views[0].customActions = [];

  panel.show(new RibbonViewNode(document, document.views[0]));

  const rendered = (vscode.window as any).__lastWebviewPanel;
  assert.match(rendered.webview.html, /No custom buttons/);
  panel.dispose();
});

test("does not preview nodes without a ribbon view", () => {
  const panel = new RibbonPreviewPanel();
  const document = documentWith();
  const [view] = document.views;

  const shown = panel.show(new RibbonSectionNode(document, view, "hideActions", 0));

  assert.strictEqual(shown, false);
  panel.dispose();
});
