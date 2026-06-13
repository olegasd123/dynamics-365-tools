import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { RibbonSourceLocator } from "../ribbonSourceLocator";

test("locates unpacked entity and application ribbon files", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(
    workspaceRoot,
    "Entities/account/RibbonDiffXml.xml",
    "<RibbonDiffXml><CustomActions /></RibbonDiffXml>",
  );
  await writeFile(
    workspaceRoot,
    "AppRibbon/RibbonDiffXml.xml",
    "<RibbonDiffXml><CustomActions /></RibbonDiffXml>",
  );

  const sources = await new RibbonSourceLocator().locate(workspaceRoot);
  const unpacked = sources.find((source) => source.kind === "unpacked");

  assert.ok(unpacked);
  assert.strictEqual(unpacked.name, "Workspace solution");
  assert.deepStrictEqual(
    unpacked.files.map((file) => ({
      kind: file.kind,
      entityLogicalName: file.entityLogicalName,
      relativePath: path.relative(workspaceRoot, file.fileUri),
    })),
    [
      {
        kind: "Application",
        entityLogicalName: undefined,
        relativePath: "AppRibbon/RibbonDiffXml.xml",
      },
      {
        kind: "Entity",
        entityLogicalName: "account",
        relativePath: "Entities/account/RibbonDiffXml.xml",
      },
    ],
  );
});

test("locates flat customizations XML files at supported paths", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(
    workspaceRoot,
    "solution/customizations.xml",
    "<ImportExportXml><RibbonDiffXml /></ImportExportXml>",
  );

  const sources = await new RibbonSourceLocator().locate(workspaceRoot);

  assert.strictEqual(sources.length, 1);
  assert.strictEqual(sources[0].kind, "flat");
  assert.strictEqual(sources[0].files[0].kind, "Flat");
  assert.strictEqual(
    path.relative(workspaceRoot, sources[0].files[0].fileUri),
    "solution/customizations.xml",
  );
});

test("locates flat customizations XML files in child folders", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(
    workspaceRoot,
    "Ribbons/hjk_/account/customizations.xml",
    "<ImportExportXml><RibbonDiffXml /></ImportExportXml>",
  );
  await writeFile(
    workspaceRoot,
    "Ribbons/hjk_/contact/Customizations.xml",
    "<ImportExportXml><RibbonDiffXml /></ImportExportXml>",
  );

  const sources = await new RibbonSourceLocator().locate(workspaceRoot);

  assert.deepStrictEqual(
    sources.map((source) => ({
      name: source.name,
      kind: source.kind,
      fileKind: source.files[0].kind,
      relativePath: path.relative(workspaceRoot, source.files[0].fileUri),
    })),
    [
      {
        name: "Ribbons/hjk_/account/customizations.xml",
        kind: "flat",
        fileKind: "Flat",
        relativePath: "Ribbons/hjk_/account/customizations.xml",
      },
      {
        name: "Ribbons/hjk_/contact/Customizations.xml",
        kind: "flat",
        fileKind: "Flat",
        relativePath: "Ribbons/hjk_/contact/Customizations.xml",
      },
    ],
  );
});

test("limits child folder flat customizations search depth", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(
    workspaceRoot,
    "one/two/three/four/customizations.xml",
    "<ImportExportXml><RibbonDiffXml /></ImportExportXml>",
  );
  await writeFile(
    workspaceRoot,
    "one/two/three/four/five/customizations.xml",
    "<ImportExportXml><RibbonDiffXml /></ImportExportXml>",
  );

  const sources = await new RibbonSourceLocator().locate(workspaceRoot);

  assert.deepStrictEqual(
    sources.map((source) => path.relative(workspaceRoot, source.files[0].fileUri)),
    ["one/two/three/four/customizations.xml"],
  );
});

test("skips generated folders when searching flat customizations XML files", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(
    workspaceRoot,
    "node_modules/sample/customizations.xml",
    "<ImportExportXml><RibbonDiffXml /></ImportExportXml>",
  );
  await writeFile(
    workspaceRoot,
    "dist/customizations.xml",
    "<ImportExportXml><RibbonDiffXml /></ImportExportXml>",
  );

  const sources = await new RibbonSourceLocator().locate(workspaceRoot);

  assert.deepStrictEqual(sources, []);
});

test("keeps imported zip sources with workspace sources", async () => {
  const workspaceRoot = await makeWorkspace();
  const locator = new RibbonSourceLocator();
  locator.addImportedSource({
    id: "zip:/tmp/core",
    kind: "zip",
    name: "core.zip",
    rootUri: "/tmp/core",
    files: [],
    zip: {
      extractedRootUri: "/tmp/core",
      entries: [],
    },
  });

  const sources = await locator.locate(workspaceRoot);

  assert.strictEqual(sources.length, 1);
  assert.strictEqual(sources[0].kind, "zip");
  assert.strictEqual(sources[0].name, "core.zip");
});

test("removes imported zip sources", async () => {
  const workspaceRoot = await makeWorkspace();
  const locator = new RibbonSourceLocator();
  locator.addImportedSource({
    id: "zip:/tmp/core",
    kind: "zip",
    name: "core.zip",
    rootUri: "/tmp/core",
    files: [],
    zip: {
      extractedRootUri: "/tmp/core",
      entries: [],
    },
  });

  assert.strictEqual(locator.removeImportedSource("zip:/tmp/core"), true);
  assert.deepStrictEqual(await locator.locate(workspaceRoot), []);
});

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-locator-"));
}

async function writeFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}
