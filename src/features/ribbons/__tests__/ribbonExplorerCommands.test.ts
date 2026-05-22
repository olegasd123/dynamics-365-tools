import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { applyRibbonPatchSequence } from "../ribbonPatchWriter";
import {
  moveRibbonNodeDown,
  moveRibbonNodeUp,
  normalizeWebResourceUniqueName,
} from "../commands/ribbonExplorerCommands";
import { RibbonPatch, RibbonSource } from "../models";
import { RibbonEditorState } from "../ribbonEditorState";
import { RibbonItemNode } from "../ribbonExplorer";
import { RibbonRepository } from "../ribbonRepository";
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
