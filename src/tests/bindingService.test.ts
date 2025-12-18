import assert from "node:assert";
import test from "node:test";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { BindingService } from "../features/webResources/bindingService";
import { BindingEntry, BindingSnapshot } from "../types";

class FakeConfigurationService {
  snapshot: BindingSnapshot;
  workspaceRoot: string;

  constructor(workspaceRoot: string, snapshot: BindingSnapshot) {
    this.workspaceRoot = workspaceRoot;
    this.snapshot = snapshot;
  }

  async loadBindings(): Promise<BindingSnapshot> {
    return this.snapshot;
  }

  async saveBindings(snapshot: BindingSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }

  createBinding(entry: BindingEntry): BindingEntry {
    return entry;
  }

  resolveLocalPath(fsPath: string): string {
    return path.isAbsolute(fsPath)
      ? path.normalize(fsPath)
      : path.normalize(path.join(this.workspaceRoot, fsPath));
  }
}

test("getBinding prefers the most specific match", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-bindings-"));
  const filePath = path.join(workspaceRoot, "web", "script.js");

  const snapshot: BindingSnapshot = {
    bindings: [
      {
        relativeLocalPath: path.join(workspaceRoot, "web"),
        remotePath: "new_/web",
        solutionName: "CoreWebResources",
        kind: "folder",
      },
      {
        relativeLocalPath: filePath,
        remotePath: "new_/web/script.js",
        solutionName: "CoreWebResources",
        kind: "file",
      },
    ],
  };

  const config = new FakeConfigurationService(workspaceRoot, snapshot);
  const service = new BindingService(config as any);

  const binding = await service.getBinding({ fsPath: filePath } as any);
  assert.strictEqual(binding?.kind, "file");
  assert.strictEqual(binding?.remotePath, "new_/web/script.js");
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("folder bindings match nested files", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-bindings-"));
  const snapshot: BindingSnapshot = {
    bindings: [
      {
        relativeLocalPath: path.join(workspaceRoot, "assets"),
        remotePath: "new_/assets",
        solutionName: "CoreWebResources",
        kind: "folder",
      },
    ],
  };

  const config = new FakeConfigurationService(workspaceRoot, snapshot);
  const service = new BindingService(config as any);

  const binding = await service.getBinding({
    fsPath: path.join(workspaceRoot, "assets", "img", "logo.png"),
  } as any);

  assert.strictEqual(binding?.kind, "folder");
  assert.strictEqual(binding?.remotePath, "new_/assets");
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("addOrUpdateBinding replaces existing entry by path", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-bindings-"));
  const filePath = path.join(workspaceRoot, "scripts", "app.js");

  const snapshot: BindingSnapshot = {
    bindings: [
      {
        relativeLocalPath: filePath,
        remotePath: "old_/scripts/app.js",
        solutionName: "CoreWebResources",
        kind: "file",
      },
    ],
  };

  const config = new FakeConfigurationService(workspaceRoot, snapshot);
  const service = new BindingService(config as any);

  await service.addOrUpdateBinding({
    relativeLocalPath: filePath,
    remotePath: "new_/scripts/app.js",
    solutionName: "Other",
    kind: "file",
  });

  assert.strictEqual(config.snapshot.bindings.length, 1);
  assert.strictEqual(config.snapshot.bindings[0].remotePath, "new_/scripts/app.js");
  assert.strictEqual(config.snapshot.bindings[0].solutionName, "Other");
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});
