import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ConfigurationService } from "../services/configurationService";

test("createBinding stores workspace-relative path when inside workspace", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xrm-config-"));
  (vscode.workspace as any).workspaceFolders = [
    { uri: vscode.Uri.file(workspaceRoot) },
  ];
  const service = new ConfigurationService();

  const inputPath = path.join(workspaceRoot, "web", "script.js");
  const binding = service.createBinding({
    relativeLocalPath: inputPath,
    remotePath: "new_/web/script.js",
    solutionName: "CoreWebResources",
    kind: "file",
  });

  const expected = path.join(path.basename(workspaceRoot), "web", "script.js");
  assert.strictEqual(binding.relativeLocalPath, expected);
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("createBinding keeps absolute path outside workspace untouched", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xrm-config-"));
  (vscode.workspace as any).workspaceFolders = [
    { uri: vscode.Uri.file(workspaceRoot) },
  ];
  const service = new ConfigurationService();

  const outsidePath = path.join(os.tmpdir(), "external", "file.js");
  const binding = service.createBinding({
    relativeLocalPath: outsidePath,
    remotePath: "new_/external/file.js",
    solutionName: "CoreWebResources",
    kind: "file",
  });

  assert.strictEqual(binding.relativeLocalPath, path.normalize(outsidePath));
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("resolveLocalPath handles workspace-namespaced relative paths", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xrm-config-"));
  const workspaceName = path.basename(workspaceRoot);
  (vscode.workspace as any).workspaceFolders = [
    { uri: vscode.Uri.file(workspaceRoot) },
  ];
  const service = new ConfigurationService();

  const boundPath = path.join(workspaceName, "folder", "file.css");
  const resolved = service.resolveLocalPath(boundPath);
  assert.strictEqual(resolved, path.join(workspaceRoot, "folder", "file.css"));
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("getRelativeToWorkspace returns input when no workspace is open", () => {
  (vscode.workspace as any).workspaceFolders = undefined;
  const service = new ConfigurationService();

  const absolutePath = path.join(os.tmpdir(), "noop.txt");
  assert.strictEqual(service.getRelativeToWorkspace(absolutePath), absolutePath);
});
