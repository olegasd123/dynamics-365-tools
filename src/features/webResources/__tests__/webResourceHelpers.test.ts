import assert from "node:assert";
import test from "node:test";
import * as path from "path";
import { MemoryWorkspaceFiles, RecordingNotifications } from "../../../testSupport/fakes";
import {
  buildSupportedSet,
  collectSupportedFiles,
  ensureSupportedResource,
} from "../core/webResourceHelpers";

test("collectSupportedFiles returns nested supported files", async () => {
  const workspaceRoot = path.join("/workspace", "project");
  const workspaceFiles = new MemoryWorkspaceFiles(workspaceRoot);
  const root = path.join(workspaceRoot, "web");
  workspaceFiles.addFile(path.join(root, "script.js"), "console.log('a')");
  workspaceFiles.addFile(path.join(root, "nested", "style.css"), "body{}");
  workspaceFiles.addFile(path.join(root, "nested", "readme.txt"), "skip");

  const files = await collectSupportedFiles({ fsPath: root }, buildSupportedSet(), workspaceFiles);
  const relative = files.map((file) => path.relative(root, file.fsPath)).sort();

  assert.deepStrictEqual(relative, ["nested/style.css", "script.js"]);
});

test("collectSupportedFiles stops when cancelled", async () => {
  const workspaceRoot = path.join("/workspace", "project");
  const workspaceFiles = new MemoryWorkspaceFiles(workspaceRoot);
  const root = path.join(workspaceRoot, "web");
  workspaceFiles.addFile(path.join(root, "script.js"), "console.log('a')");

  const token = {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose: () => {} }),
  };

  const files = await collectSupportedFiles(
    { fsPath: root },
    buildSupportedSet(),
    workspaceFiles,
    token,
  );
  assert.deepStrictEqual(files, []);
});

test("ensureSupportedResource reports unsupported files through notification port", async () => {
  const workspaceRoot = path.join("/workspace", "project");
  const workspaceFiles = new MemoryWorkspaceFiles(workspaceRoot);
  const file = path.join(workspaceRoot, "notes.txt");
  workspaceFiles.addFile(file, "skip");
  const notifications = new RecordingNotifications();

  const supported = await ensureSupportedResource(
    { fsPath: file },
    buildSupportedSet(),
    workspaceFiles,
    notifications,
  );

  assert.strictEqual(supported, false);
  assert.deepStrictEqual(notifications.infos, [
    "Dynamics 365 Tools actions are available only for supported web resource types.",
  ]);
});
