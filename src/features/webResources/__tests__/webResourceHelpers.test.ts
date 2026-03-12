import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { buildSupportedSet, collectSupportedFiles } from "../core/webResourceHelpers";

test("collectSupportedFiles returns nested supported files", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-helpers-"));
  const root = path.join(workspaceRoot, "web");
  await fs.mkdir(path.join(root, "nested"), { recursive: true });
  await fs.writeFile(path.join(root, "script.js"), "console.log('a')");
  await fs.writeFile(path.join(root, "nested", "style.css"), "body{}");
  await fs.writeFile(path.join(root, "nested", "readme.txt"), "skip");

  const files = await collectSupportedFiles(vscode.Uri.file(root), buildSupportedSet());
  const relative = files.map((file) => path.relative(root, file.fsPath)).sort();

  assert.deepStrictEqual(relative, ["nested/style.css", "script.js"]);
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("collectSupportedFiles stops when cancelled", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-helpers-"));
  const root = path.join(workspaceRoot, "web");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "script.js"), "console.log('a')");

  const token = {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose: () => {} }),
  } as vscode.CancellationToken;

  const files = await collectSupportedFiles(vscode.Uri.file(root), buildSupportedSet(), token);
  assert.deepStrictEqual(files, []);

  await fs.rm(workspaceRoot, { recursive: true, force: true });
});
