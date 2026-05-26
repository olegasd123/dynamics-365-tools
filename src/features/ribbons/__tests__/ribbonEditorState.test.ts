import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { RibbonSource } from "../models";
import { createHideActionPatches } from "../ribbonEditPatches";
import { RibbonEditorState } from "../ribbonEditorState";
import { RibbonRepository } from "../ribbonRepository";

test("keeps queued ribbon patches visible until save", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-state-"));
  const filePath = path.join(workspaceRoot, "Entities", "account", "RibbonDiffXml.xml");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `<RibbonDiffXml>
  <CustomActions />
</RibbonDiffXml>`,
    "utf8",
  );
  const source: RibbonSource = {
    id: "unpacked:test",
    kind: "unpacked",
    name: "Workspace solution",
    rootUri: workspaceRoot,
    files: [{ fileUri: filePath, kind: "Entity", entityLogicalName: "account" }],
  };
  const state = new RibbonEditorState(new RibbonRepository());
  const [document] = await state.loadSource(source);

  state.queuePatches(
    document,
    createHideActionPatches(document, {
      hideActionId: "d365tools.account.Form.Hide.Mscrm.SavePrimary",
      location: "Mscrm.Form.account.MainTab.Save.Controls._children",
    }),
  );

  assert.strictEqual(state.isSourceDirty(source.id), true);
  const [updatedDocument] = await state.loadSource(source);
  assert.strictEqual(updatedDocument.views[0].hideActions.length, 1);
  assert.doesNotMatch(await fs.readFile(filePath, "utf8"), /HideCustomAction/);

  const result = await state.saveSource(source.id);

  assert.deepStrictEqual(result.changedFileUris, [filePath]);
  assert.strictEqual(state.isSourceDirty(source.id), false);
  assert.match(await fs.readFile(filePath, "utf8"), /HideCustomAction/);
});

test("undoes and redoes pending ribbon edits across the working set", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-state-"));
  const filePath = path.join(workspaceRoot, "Entities", "account", "RibbonDiffXml.xml");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `<RibbonDiffXml>
  <CustomActions />
</RibbonDiffXml>`,
    "utf8",
  );
  const source: RibbonSource = {
    id: "unpacked:test",
    kind: "unpacked",
    name: "Workspace solution",
    rootUri: workspaceRoot,
    files: [{ fileUri: filePath, kind: "Entity", entityLogicalName: "account" }],
  };
  const state = new RibbonEditorState(new RibbonRepository());
  const [document] = await state.loadSource(source);

  state.queuePatches(
    document,
    createHideActionPatches(document, {
      hideActionId: "d365tools.account.Form.Hide.Mscrm.SavePrimary",
      location: "Mscrm.Form.account.MainTab.Save.Controls._children",
    }),
  );

  const [documentWithFirstEdit] = await state.loadSource(source);
  state.queuePatches(
    documentWithFirstEdit,
    createHideActionPatches(documentWithFirstEdit, {
      hideActionId: "d365tools.account.Form.Hide.Mscrm.SaveAndClosePrimary",
      location: "Mscrm.Form.account.MainTab.Save.Controls._children",
    }),
  );

  assert.strictEqual(state.canUndo(), true);
  assert.strictEqual(state.canRedo(), false);
  assert.strictEqual((await state.loadSource(source))[0].views[0].hideActions.length, 2);

  assert.strictEqual(state.undo(), true);
  assert.strictEqual(state.canRedo(), true);
  assert.strictEqual((await state.loadSource(source))[0].views[0].hideActions.length, 1);

  assert.strictEqual(state.redo(), true);
  assert.strictEqual((await state.loadSource(source))[0].views[0].hideActions.length, 2);

  await state.saveSource(source.id);

  assert.strictEqual(state.canUndo(), false);
  assert.strictEqual(state.canRedo(), false);
  assert.strictEqual(state.undo(), false);
  assert.match(await fs.readFile(filePath, "utf8"), /SaveAndClosePrimary/);
});
