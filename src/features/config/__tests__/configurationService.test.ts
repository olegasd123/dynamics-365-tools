import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { NodeWorkspaceFiles } from "../../../testSupport/fakes";
import { ConfigurationService } from "../configurationService";

function createService(workspaceRoot: string | undefined): ConfigurationService {
  return new ConfigurationService(new NodeWorkspaceFiles(workspaceRoot));
}

test("createBinding stores workspace-relative path when inside workspace", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-config-"));
  const service = createService(workspaceRoot);

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
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-config-"));
  const service = createService(workspaceRoot);

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
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-config-"));
  const workspaceName = path.basename(workspaceRoot);
  const service = createService(workspaceRoot);

  const boundPath = path.join(workspaceName, "folder", "file.css");
  const resolved = service.resolveLocalPath(boundPath);
  assert.strictEqual(resolved, path.join(workspaceRoot, "folder", "file.css"));
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("getRelativeToWorkspace returns input when no workspace is open", () => {
  const service = createService(undefined);

  const absolutePath = path.join(os.tmpdir(), "noop.txt");
  assert.strictEqual(service.getRelativeToWorkspace(absolutePath), absolutePath);
});

test("loadExistingConfiguration does not create config when missing", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-config-"));
  const service = createService(workspaceRoot);

  const loaded = await service.loadExistingConfiguration();
  assert.strictEqual(loaded, undefined);

  const configPath = path.join(workspaceRoot, ".vscode", "dynamics365tools.config.json");
  const exists = await fs
    .stat(configPath)
    .then(() => true)
    .catch(() => false);
  assert.strictEqual(exists, false);
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("loadConfiguration returns empty config and does not create file when missing", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-config-"));
  const service = createService(workspaceRoot);

  const loaded = await service.loadConfiguration();
  assert.deepStrictEqual(loaded, { environments: [], solutions: [] });

  const configPath = path.join(workspaceRoot, ".vscode", "dynamics365tools.config.json");
  const exists = await fs
    .stat(configPath)
    .then(() => true)
    .catch(() => false);
  assert.strictEqual(exists, false);
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("loadConfiguration normalizes legacy solutionName property", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-config-"));
  const service = createService(workspaceRoot);
  const config = {
    environments: [{ name: "dev", url: "https://example" }],
    solutions: [{ solutionName: "LegacySolution", prefix: "new_" }],
  };

  const configPath = path.join(workspaceRoot, ".vscode", "dynamics365tools.config.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, Buffer.from(JSON.stringify(config, null, 2)));

  const loaded = await service.loadConfiguration();
  assert.strictEqual(loaded.solutions[0].name, "LegacySolution");
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("loadConfiguration defaults missing solutions to empty array", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-config-"));
  const service = createService(workspaceRoot);
  const config = {
    environments: [{ name: "dev", url: "https://example" }],
  };

  const configPath = path.join(workspaceRoot, ".vscode", "dynamics365tools.config.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, Buffer.from(JSON.stringify(config, null, 2)));

  const loaded = await service.loadConfiguration();
  assert.deepStrictEqual(loaded.solutions, []);
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});
