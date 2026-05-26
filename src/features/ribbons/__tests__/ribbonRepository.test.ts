import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { RibbonSource } from "../models";
import { RibbonRepository } from "../ribbonRepository";

test("loads unpacked source files with source metadata", async () => {
  const workspaceRoot = await makeWorkspace();
  const ribbonPath = await writeFile(
    workspaceRoot,
    "Entities/account/RibbonDiffXml.xml",
    `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.account.Form.Button.CustomAction" Location="Mscrm.Form.account.MainTab.Save.Controls._children" />
  </CustomActions>
</RibbonDiffXml>`,
  );
  const source: RibbonSource = {
    id: "unpacked:test",
    kind: "unpacked",
    name: "Workspace solution",
    rootUri: workspaceRoot,
    files: [{ fileUri: ribbonPath, kind: "Entity", entityLogicalName: "account" }],
  };

  const documents = await new RibbonRepository().loadSource(source);

  assert.strictEqual(documents.length, 1);
  assert.strictEqual(documents[0].sourceId, source.id);
  assert.strictEqual(documents[0].kind, "Entity");
  assert.strictEqual(documents[0].entityLogicalName, "account");
  assert.deepStrictEqual(
    documents[0].views.map((view) => view.scope),
    ["Form", "HomepageGrid", "SubGrid"],
  );
});

test("loads flat customizations XML and infers entity ribbons", async () => {
  const workspaceRoot = await makeWorkspace();
  const customizationsPath = await writeFile(
    workspaceRoot,
    "customizations.xml",
    `<ImportExportXml>
  <Entities>
    <Entity>
      <Name>account</Name>
      <RibbonDiffXml><CustomActions /></RibbonDiffXml>
    </Entity>
  </Entities>
  <RibbonDiffXml><CustomActions /></RibbonDiffXml>
</ImportExportXml>`,
  );
  const source: RibbonSource = {
    id: "flat:test",
    kind: "flat",
    name: "customizations.xml",
    rootUri: workspaceRoot,
    files: [{ fileUri: customizationsPath, kind: "Flat" }],
  };

  const documents = await new RibbonRepository().loadSource(source);

  assert.strictEqual(documents.length, 2);
  assert.strictEqual(documents[0].kind, "Entity");
  assert.strictEqual(documents[0].entityLogicalName, "account");
  assert.strictEqual(documents[1].kind, "Application");
  assert.strictEqual(documents[1].views[0].scope, "Application");
});

test("saves only files whose patches change text", async () => {
  const workspaceRoot = await makeWorkspace();
  const filePath = await writeFile(
    workspaceRoot,
    "RibbonDiffXml.xml",
    "<RibbonDiffXml><CustomActions /></RibbonDiffXml>",
  );
  const repository = new RibbonRepository();

  const noChange = await repository.savePatches({
    [filePath]: [{ kind: "replace", range: { start: 0, end: 0 }, text: "" }],
  });
  assert.deepStrictEqual(noChange.changedFileUris, []);

  const changed = await repository.savePatches({
    [filePath]: [
      {
        kind: "insert",
        offset: "<RibbonDiffXml><CustomActions".length,
        text: ' Foo="Bar"',
      },
    ],
  });

  assert.deepStrictEqual(changed.changedFileUris, [filePath]);
  assert.strictEqual(
    await fs.readFile(filePath, "utf8"),
    '<RibbonDiffXml><CustomActions Foo="Bar" /></RibbonDiffXml>',
  );
});

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-repository-"));
}

async function writeFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const filePath = path.join(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}
