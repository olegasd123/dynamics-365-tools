import assert from "node:assert/strict";
import test from "node:test";
import * as vscode from "vscode";
import { CommandContext } from "@app/commandContext";
import { openRibbonFile } from "../commands/ribbonSourceCommands";
import { TextRange } from "../models";
import {
  RibbonDocumentNode,
  RibbonItemNode,
  RibbonSectionNode,
  RibbonViewNode,
} from "../ribbonExplorer";
import { resolveRibbonXmlRange, ribbonXmlTarget } from "../ribbonXmlNavigation";
import { readRibbonDocuments } from "../ribbonXmlReader";

const reference = '<EnableRule Id="new.Enable" />';
const step = '<CustomRule Library="$webresource:new_/rules.js" FunctionName="check" />';
const rule = `<EnableRule Id="new.Enable">${step}</EnableRule>`;
const xml = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <EnableRules>${reference}</EnableRules>
      <Actions />
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions><EnableRules>${rule}</EnableRules></RuleDefinitions>
</RibbonDiffXml>`;

function rangeOf(text: string, content: string): TextRange {
  const start = text.indexOf(content);
  assert.ok(start >= 0, `Missing fixture content: ${content}`);
  return { start, end: start + content.length };
}

function documentFrom(text = xml) {
  return readRibbonDocuments(text, {
    sourceId: "source",
    fileUri: "/workspace/customizations.xml",
  })[0];
}

function itemFrom(content: string, text = xml) {
  return new RibbonItemNode("Item", undefined, "d365RibbonEnableRule", "check", [], [], {
    document: documentFrom(text),
    range: rangeOf(text, content),
  });
}

test("selects exact rules, references, and nested steps after offsets shift", () => {
  const current = `\uFEFF<!-- 😀 header -->\r\n${xml.split("\n").join("\r\n")}`;
  for (const content of [rule, reference, step]) {
    assert.deepEqual(
      resolveRibbonXmlRange(xml, rangeOf(xml, content), current),
      rangeOf(current, content),
    );
  }
});

test("finds an element by ID when its attributes or children change", () => {
  const updatedRule = '<EnableRule Id="new.Enable"><SelectionCountRule Minimum="1" /></EnableRule>';
  const current = xml.replace(rule, updatedRule);
  assert.deepEqual(
    resolveRibbonXmlRange(xml, rangeOf(xml, rule), current),
    rangeOf(current, updatedRule),
  );
  assert.equal(resolveRibbonXmlRange(xml, rangeOf(xml, step), current), undefined);
});

test("keeps entity identity when flat XML contains repeated IDs and entities move", () => {
  const account = `<Entity><Name LocalizedName="Account">account</Name>${xml}</Entity>`;
  const contact = `<Entity><Name>contact</Name>${xml}</Entity>`;
  const original = `<ImportExportXml><Entities>${account}${contact}</Entities></ImportExportXml>`;
  const current = `<ImportExportXml><Entities>${contact}${account}</Entities></ImportExportXml>`;
  const expected = current.indexOf(rule, current.indexOf(account));
  assert.deepEqual(resolveRibbonXmlRange(original, rangeOf(original, rule), current), {
    start: expected,
    end: expected + rule.length,
  });
});

test("matches anonymous steps by attributes when siblings are inserted or reordered", () => {
  const other = step.replace('FunctionName="check"', 'FunctionName="other"');
  const original = xml.replace(step, other + step);
  const current = xml.replace(step, step + '<ValueRule Value="true" />' + other);
  assert.deepEqual(
    resolveRibbonXmlRange(original, rangeOf(original, step), current),
    rangeOf(current, step),
  );
});

test("does not guess between duplicate anonymous steps after a change", () => {
  const pending = xml.replace(step, step + step);
  assert.equal(resolveRibbonXmlRange(pending, rangeOf(pending, step), xml), undefined);
});

test("preserves duplicate step positions when their containing rule is unchanged", () => {
  const original = xml.replace(step, step + step);
  const secondStart = original.indexOf(step, original.indexOf(step) + 1);
  const range = { start: secondStart, end: secondStart + step.length };
  const current = `<!-- header -->${original}`;
  assert.deepEqual(resolveRibbonXmlRange(original, range, current), {
    start: range.start + 15,
    end: range.end + 15,
  });
});

test("does not confuse a missing rule definition with its reference", () => {
  const current = xml.replace(rule, "");
  assert.equal(resolveRibbonXmlRange(xml, rangeOf(xml, rule), current), undefined);
});

test("uses ribbon roots for documents and views, and containers for sections", () => {
  const document = documentFrom();
  const view = document.views[0];
  for (const node of [new RibbonDocumentNode(document), new RibbonViewNode(document, view)]) {
    assert.deepEqual(ribbonXmlTarget(node)?.range, document.ribbonRange);
  }
  assert.deepEqual(
    ribbonXmlTarget(new RibbonSectionNode(document, view, "enableRules", 1))?.range,
    rangeOf(xml, `<EnableRules>${rule}</EnableRules>`),
  );
  assert.deepEqual(
    ribbonXmlTarget(new RibbonSectionNode(document, view, "displayRules", 0))?.range,
    document.sections.ruleDefinitions,
  );
  assert.deepEqual(
    ribbonXmlTarget(new RibbonSectionNode(document, view, "customActions", 0))?.range,
    document.ribbonRange,
  );
});

test("selects group containers without changing their command edit targets", () => {
  const document = documentFrom();
  const command = document.views[0].commandDefinitions[0];
  for (const [context, content] of [
    ["d365RibbonActions", "<Actions />"],
    ["d365RibbonEnableRuleRefs", `<EnableRules>${reference}</EnableRules>`],
    ["d365RibbonDisplayRuleRefs", xml.slice(command.range.start, command.range.end)],
  ]) {
    const node = new RibbonItemNode("Group", undefined, context, "references", [], [], {
      document,
      range: command.range,
    });
    assert.deepEqual(ribbonXmlTarget(node)?.range, rangeOf(xml, content));
    assert.deepEqual(node.editTarget?.range, command.range);
  }
});

test("opens the actual editor buffer and selects the full element", async (t) => {
  const current = `<!-- unsaved editor change -->\n${xml}`;
  const expected = rangeOf(current, rule);
  const positionAt = (offset: number) => {
    const lines = current.slice(0, offset).split("\n");
    return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
  };
  const textDocument = { getText: () => current, positionAt } as vscode.TextDocument;
  const originalOpen = vscode.workspace.openTextDocument;
  let openedUri: vscode.Uri | undefined;
  vscode.workspace.openTextDocument = (async (uri: vscode.Uri) => {
    openedUri = uri;
    return textDocument;
  }) as unknown as typeof vscode.workspace.openTextDocument;
  t.after(() => {
    vscode.workspace.openTextDocument = originalOpen;
  });

  const reveals: vscode.Range[] = [];
  const show = t.mock.method(vscode.window, "showTextDocument", async () => ({
    revealRange: (range: vscode.Range) => reveals.push(range),
  }));
  await openRibbonFile({} as CommandContext, itemFrom(rule));
  assert.equal(openedUri?.fsPath, "/workspace/customizations.xml");
  assert.equal(show.mock.callCount(), 1);
  assert.equal(show.mock.calls[0].arguments[0], textDocument);
  assert.deepEqual(show.mock.calls[0].arguments[1], {
    preview: false,
    selection: new vscode.Range(positionAt(expected.start), positionAt(expected.end)),
  });
  assert.deepEqual(reveals, [
    new vscode.Range(positionAt(expected.start), positionAt(expected.start)),
  ]);
});

test("asks to save pending Ribbon items or refresh stale items without selecting unrelated XML", async (t) => {
  const originalOpen = vscode.workspace.openTextDocument;
  vscode.workspace.openTextDocument = (async () => ({
    getText: () => xml.replace(rule, ""),
  })) as unknown as typeof vscode.workspace.openTextDocument;
  t.after(() => {
    vscode.workspace.openTextDocument = originalOpen;
  });
  const show = t.mock.method(vscode.window, "showTextDocument");
  const warnings: string[] = [];
  for (const dirty of [true, false]) {
    const ctx = {
      core: { notifications: { warning: async (message: string) => warnings.push(message) } },
      ribbon: { editorState: { isFileDirty: () => dirty } },
    } as unknown as CommandContext;
    await openRibbonFile(ctx, itemFrom(rule));
  }
  assert.match(warnings[0], /Save your Ribbon changes/);
  assert.match(warnings[1], /Refresh the Ribbon tree/);
  assert.equal(show.mock.callCount(), 0);
});
