import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { RibbonRepository } from "../ribbonRepository";
import { SolutionZipService } from "../solutionZipService";

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

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-zip-"));
}

async function zipBuffer(zip: JSZip): Promise<Buffer> {
  return zip.generateAsync({ type: "nodebuffer" });
}
