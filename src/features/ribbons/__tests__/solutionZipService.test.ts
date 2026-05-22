import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { RibbonRepository } from "../ribbonRepository";
import { cleanRibbonZipsFolder, SolutionZipService } from "../solutionZipService";

test("opens solution zip as a ribbon source", async () => {
  const storageRoot = await makeWorkspace();
  const zip = new JSZip();
  zip.file(
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
  zip.file("WebResources/account.js", "function saveAccount() {}");
  zip.file("../unsafe.xml", "<bad />");

  const source = await new SolutionZipService().openZipBuffer(await zipBuffer(zip), {
    storageRoot,
    sourceName: "core.zip",
  });

  assert.strictEqual(source.kind, "zip");
  assert.strictEqual(source.name, "core.zip");
  assert.strictEqual(source.files.length, 1);
  assert.strictEqual(source.files[0].kind, "Flat");
  assert.ok(!source.zip?.entries.includes("../unsafe.xml"));
  assert.ok(!source.zip?.entries.includes("unsafe.xml"));
  assert.strictEqual(
    await fileExists(path.join(source.zip?.extractedRootUri ?? "", "unsafe.xml")),
    false,
  );

  const documents = await new RibbonRepository().loadSource(source);
  assert.strictEqual(documents.length, 2);
  assert.deepStrictEqual(
    documents.map((document) => document.kind),
    ["Entity", "Application"],
  );
});

test("saves extracted solution source back to a zip", async () => {
  const storageRoot = await makeWorkspace();
  const zip = new JSZip();
  zip.file("customizations.xml", "<ImportExportXml><RibbonDiffXml /></ImportExportXml>");
  zip.file("solution.xml", "<ImportExportXml />");

  const service = new SolutionZipService();
  const source = await service.openZipBuffer(await zipBuffer(zip), {
    storageRoot,
    sourceName: "core.zip",
  });
  const customizationsPath = source.files[0].fileUri;
  await fs.writeFile(
    customizationsPath,
    "<ImportExportXml><RibbonDiffXml><CustomActions /></RibbonDiffXml></ImportExportXml>",
    "utf8",
  );

  const outputPath = path.join(storageRoot, "saved.zip");
  await service.saveSourceToZip(source, outputPath);

  const saved = await JSZip.loadAsync(await fs.readFile(outputPath));
  assert.strictEqual(
    await saved.file("customizations.xml")?.async("string"),
    "<ImportExportXml><RibbonDiffXml><CustomActions /></RibbonDiffXml></ImportExportXml>",
  );
  assert.strictEqual(await saved.file("solution.xml")?.async("string"), "<ImportExportXml />");
});

test("fails zip save when an extracted entry is missing", async () => {
  const storageRoot = await makeWorkspace();
  const zip = new JSZip();
  zip.file("customizations.xml", "<ImportExportXml><RibbonDiffXml /></ImportExportXml>");

  const service = new SolutionZipService();
  const source = await service.openZipBuffer(await zipBuffer(zip), {
    storageRoot,
    sourceName: "core.zip",
  });

  await fs.unlink(path.join(source.zip?.extractedRootUri ?? "", "customizations.xml"));

  await assert.rejects(
    () => service.saveSourceToZip(source, path.join(storageRoot, "saved.zip")),
    /Extracted zip entry is missing: customizations\.xml/,
  );
});

test("cleanRibbonZipsFolder does nothing when folder does not exist", async () => {
  const missing = path.join(os.tmpdir(), `d365-missing-${Date.now()}`);
  await assert.doesNotReject(() => cleanRibbonZipsFolder(missing, 5));
});

test("cleanRibbonZipsFolder keeps all directories when count is within limit", async () => {
  const root = await makeWorkspace();
  const dirs = await makeDirs(root, ["a", "b", "c"]);

  await cleanRibbonZipsFolder(root, 5);

  const remaining = await readDirNames(root);
  assert.deepStrictEqual(remaining.sort(), dirs.sort());
});

test("cleanRibbonZipsFolder removes oldest directories beyond keepCount", async () => {
  const root = await makeWorkspace();
  // dirs[0] = oldest, dirs[4] = newest
  const dirs = await makeDirs(root, ["d0", "d1", "d2", "d3", "d4"]);

  await cleanRibbonZipsFolder(root, 3);

  const remaining = await readDirNames(root);
  assert.deepStrictEqual(remaining.sort(), [dirs[2], dirs[3], dirs[4]].sort());
});

test("cleanRibbonZipsFolder deletes all directories when keepCount is 0", async () => {
  const root = await makeWorkspace();
  await makeDirs(root, ["x", "y"]);

  await cleanRibbonZipsFolder(root, 0);

  const remaining = await readDirNames(root);
  assert.deepStrictEqual(remaining, []);
});

async function makeDirs(root: string, names: string[]): Promise<string[]> {
  const now = Date.now();
  for (let i = 0; i < names.length; i++) {
    const dir = path.join(root, names[i]);
    await fs.mkdir(dir);
    const mtime = new Date(now - (names.length - 1 - i) * 10_000);
    await fs.utimes(dir, mtime, mtime);
  }
  return names;
}

async function readDirNames(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-zip-"));
}

async function zipBuffer(zip: JSZip): Promise<Buffer> {
  return zip.generateAsync({ type: "nodebuffer" });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}
