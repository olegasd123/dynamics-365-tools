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
