import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { PcfControlProject } from "../models";
import { PcfBuildService } from "../pcfBuildService";

test("build runs npm build and records success", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-build-"));
  await fs.mkdir(path.join(root, "node_modules"));
  const calls: string[] = [];
  const npm = {
    readPackageInfo: async () => ({ scripts: { build: "pcf-scripts build" } }),
    runScript: async (_root: string, script: string) => {
      calls.push(script);
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 7,
      };
    },
  };
  const service = new PcfBuildService(npm as any, createStatusBarStub());
  const project = createProject(root);

  try {
    const ok = await service.build(project);

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(calls, ["build"]);
    assert.strictEqual(service.getBuildStatus(project).kind, "success");
  } finally {
    service.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("watch starts only for the generated PCF start script", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-watch-"));
  const calls: string[][] = [];
  const npm = {
    readPackageInfo: async () => ({ scripts: { start: "pcf-scripts start" } }),
    startDefault: (_root: string, args: string[]) => {
      calls.push(args);
      return {
        command: "npm",
        args: ["start", ...args],
        exited: new Promise(() => undefined),
        kill: () => undefined,
      };
    },
  };
  const service = new PcfBuildService(npm as any, createStatusBarStub());
  const project = createProject(root);

  try {
    const ok = await service.startWatch(project);

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(calls, [["watch"]]);
    assert.strictEqual(service.isWatching(project), true);
  } finally {
    service.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

function createProject(rootUri: string): PcfControlProject {
  return {
    rootUri,
    manifestUri: path.join(rootUri, "ControlManifest.Input.xml"),
    namespace: "Contoso",
    constructor: "LinearInput",
    fullName: "Contoso.LinearInput",
    version: "1.0.0",
    controlType: "field",
    templateKind: "ts",
    outputDir: path.join(rootUri, "out", "controls", "LinearInput"),
    hasNodeModules: true,
  };
}

function createStatusBarStub() {
  return {
    setWatching: () => undefined,
    clear: () => undefined,
  } as any;
}
