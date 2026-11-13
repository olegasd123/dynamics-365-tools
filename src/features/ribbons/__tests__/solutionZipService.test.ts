import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { RibbonRepository } from "../ribbonRepository";
import { RibbonEditorState } from "../ribbonEditorState";
import { createCustomButtonPatches } from "../ribbonEditPatches";
import {
  cleanRibbonZipsFolder,
  isSolutionExportCancelledError,
  SolutionZipService,
} from "../solutionZipService";

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

test("reopens saved ribbon edits after restarting without downloading or extracting again", async () => {
  const storageRoot = await makeWorkspace();
  const zip = new JSZip();
  zip.file("customizations.xml", "<ImportExportXml><RibbonDiffXml /></ImportExportXml>");
  zip.file("WebResources/script.js", "function run() {}");
  const source = await new SolutionZipService().openZipBuffer(await zipBuffer(zip), {
    storageRoot,
    sourceName: "Core Solution.zip",
    originalZipUri: path.join(storageRoot, "original.zip"),
  });
  const editor = new RibbonEditorState(new RibbonRepository());
  const [document] = await editor.loadSource(source);
  editor.queuePatches(
    document,
    createCustomButtonPatches(document, {
      customActionId: "new.Action",
      buttonId: "new.Button",
      commandId: "new.Command",
      location: "Mscrm.GlobalTab.MainTab.Actions.Controls._children",
      labelText: "Saved local change",
      action: { kind: "Url", address: "https://contoso.example" },
    }),
  );
  await editor.saveSource(source.id);
  const savedXml = await fs.readFile(source.files[0].fileUri, "utf8");

  const restartedService = new SolutionZipService();
  const [imported] = await restartedService.listImportedSolutions(storageRoot);
  assert.deepStrictEqual(imported.source, source);
  assert.ok(Number.isFinite(imported.importedAt));
  const [reopened] = await new RibbonEditorState(new RibbonRepository()).loadSource(
    imported.source,
  );
  assert.strictEqual(reopened.sourceText, savedXml);
  assert.match(reopened.sourceText, /Saved local change/);
  const output = path.join(storageRoot, "recovered.zip");
  await restartedService.saveSourceToZip(imported.source, output);
  const recoveredZip = await JSZip.loadAsync(await fs.readFile(output));
  assert.strictEqual(await recoveredZip.file("customizations.xml")?.async("string"), savedXml);
  assert.strictEqual(
    await recoveredZip.file("WebResources/script.js")?.async("string"),
    "function run() {}",
  );
  assert.deepStrictEqual(
    Object.values(recoveredZip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort(),
    source.zip?.entries.slice().sort(),
  );
  assert.strictEqual(
    (await fs.readdir(path.join(storageRoot, "ribbon-zips"), { withFileTypes: true })).filter(
      (entry) => entry.isDirectory(),
    ).length,
    1,
  );
});

test("lists repeated solution imports by import date, latest first", async (t) => {
  const storageRoot = await makeWorkspace();
  const zip = new JSZip();
  zip.file("customizations.xml", "<ImportExportXml><RibbonDiffXml /></ImportExportXml>");
  const buffer = await zipBuffer(zip);
  const service = new SolutionZipService();
  let now = Date.UTC(2026, 0, 1);
  t.mock.method(Date, "now", () => now);
  const sources = [];
  for (let i = 0; i < 3; i++) {
    sources.push(await service.openZipBuffer(buffer, { storageRoot, sourceName: "core.zip" }));
    now += 60_000;
  }
  await fs.utimes(sources[0].rootUri, new Date(now), new Date(now));

  const imported = await new SolutionZipService().listImportedSolutions(storageRoot);

  assert.deepStrictEqual(
    imported.map(({ source }) => source.id),
    sources.map((source) => source.id).reverse(),
  );
  assert.deepStrictEqual(
    imported.map(({ source }) => source.name),
    ["core.zip", "core.zip", "core.zip"],
  );
  assert.deepStrictEqual(
    imported.map(({ importedAt }) => importedAt),
    [now - 60_000, now - 120_000, now - 180_000],
  );
});

test("finds older imported folders without valid metadata and skips empty folders", async () => {
  const storageRoot = await makeWorkspace();
  const parent = path.join(storageRoot, "ribbon-zips");
  const oldRoot = path.join(parent, "legacy-zip-abc123");
  const newerRoot = path.join(parent, "recent-zip-xyz789");
  await fs.mkdir(path.join(oldRoot, "Entities", "account"), { recursive: true });
  await fs.mkdir(path.join(oldRoot, "AppRibbon"));
  await fs.writeFile(
    path.join(oldRoot, "Entities", "account", "RibbonDiffXml.xml"),
    "<RibbonDiffXml />",
  );
  await fs.writeFile(path.join(oldRoot, "AppRibbon", "RibbonDiffXml.xml"), "<RibbonDiffXml />");
  await fs.mkdir(path.join(newerRoot, "Other"), { recursive: true });
  await fs.writeFile(
    path.join(newerRoot, "Other", "Customizations.xml"),
    "<ImportExportXml><RibbonDiffXml /></ImportExportXml>",
  );
  await fs.writeFile(`${newerRoot}.json`, "{broken");
  await fs.mkdir(path.join(parent, "empty"));
  await fs.writeFile(path.join(parent, "unrelated.txt"), "ignore");
  const oldDate = new Date("2026-01-01T00:00:00Z");
  const newerDate = new Date("2026-02-01T00:00:00Z");
  await fs.utimes(oldRoot, oldDate, oldDate);
  await fs.utimes(newerRoot, newerDate, newerDate);

  const imported = await new SolutionZipService().listImportedSolutions(storageRoot);

  assert.deepStrictEqual(
    imported.map(({ source }) => source.name),
    ["recent.zip", "legacy.zip"],
  );
  assert.deepStrictEqual(
    imported.map(({ importedAt }) => importedAt),
    [newerDate.getTime(), oldDate.getTime()],
  );
  assert.deepStrictEqual(
    imported[1].source.files.map((file) => file.kind),
    ["Application", "Entity"],
  );
  assert.strictEqual(imported[0].source.files[0].kind, "Flat");
  assert.deepStrictEqual(imported[1].source.zip?.entries, [
    "AppRibbon/RibbonDiffXml.xml",
    "Entities/account/RibbonDiffXml.xml",
  ]);
  assert.deepStrictEqual(
    (await new RibbonRepository().loadSource(imported[1].source)).map((document) => document.kind),
    ["Application", "Entity"],
  );
});

test("returns no imported solutions when storage has not been created", async () => {
  const storageRoot = await makeWorkspace();
  assert.deepStrictEqual(await new SolutionZipService().listImportedSolutions(storageRoot), []);
});

test("saves exported solution buffer to a zip", async () => {
  const storageRoot = await makeWorkspace();
  const outputPath = path.join(storageRoot, "backup", "core.zip");
  const buffer = Buffer.from("zip-content");

  const savedPath = await new SolutionZipService().saveBufferToZip(buffer, outputPath);

  assert.strictEqual(savedPath, outputPath);
  assert.deepStrictEqual(await fs.readFile(outputPath), buffer);
});

test("does not start solution export when already cancelled", async () => {
  let postCalled = false;
  const token = {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  };

  await assert.rejects(
    () =>
      new SolutionZipService().downloadSolutionZip(
        {
          post: async () => {
            postCalled = true;
            return {};
          },
        } as any,
        "core",
        token as any,
      ),
    isSolutionExportCancelledError,
  );

  assert.strictEqual(postCalled, false);
});

test("aborts active solution export on cancellation", async () => {
  let listener: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (callback: () => void) => {
      listener = callback;
      return { dispose: () => undefined };
    },
  };
  const exportPromise = new SolutionZipService().downloadSolutionZip(
    {
      post: async (_path: string, _body: unknown, options?: { signal?: AbortSignal }) => {
        signal = options?.signal;
        listener?.();
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    } as any,
    "core",
    token as any,
  );

  await assert.rejects(() => exportPromise, isSolutionExportCancelledError);
  assert.strictEqual(signal?.aborted, true);
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
  for (const directory of dirs) {
    await fs.writeFile(path.join(root, `${directory}.json`), "{}");
  }

  await cleanRibbonZipsFolder(root, 3);

  const remaining = await readDirNames(root);
  assert.deepStrictEqual(remaining.sort(), [dirs[2], dirs[3], dirs[4]].sort());
  assert.deepStrictEqual((await fs.readdir(root)).filter((name) => name.endsWith(".json")).sort(), [
    "d2.json",
    "d3.json",
    "d4.json",
  ]);
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
