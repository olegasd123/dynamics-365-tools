import assert from "node:assert";
import test from "node:test";
import * as path from "path";
import { MemoryWorkspaceFiles, RecordingDiagnostics } from "../../../testSupport/fakes";
import { PcfControlProject } from "../models";
import { PcfBuildService } from "../pcfBuildService";

test("build runs npm build and records success", async () => {
  const root = "/workspace/controls/LinearInput";
  const files = new MemoryWorkspaceFiles("/workspace");
  const diagnostics = new RecordingDiagnostics();
  files.addDirectory(path.join(root, "node_modules"));
  const calls: string[] = [];
  const npm = {
    readPackageInfo: async () => ({ scripts: { build: "pcf-scripts build" } }),
    runScript: async (_root: string, script: string) => {
      calls.push(script);
      return {
        exitCode: 0,
        stdout: "src/index.ts(2,3): error TS1234: Example diagnostic",
        stderr: "",
        durationMs: 7,
      };
    },
  };
  const service = new PcfBuildService(npm as any, createStatusBarStub(), files, diagnostics);
  const project = createProject(root);

  try {
    const ok = await service.build(project);

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(calls, ["build"]);
    assert.strictEqual(service.getBuildStatus(project).kind, "success");
    assert.deepStrictEqual(diagnostics.entries.get(path.join(root, "src", "index.ts")), [
      {
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 3 },
        },
        message: "TS1234: Example diagnostic",
        severity: "error",
      },
    ]);
  } finally {
    service.dispose();
  }
});

test("watch starts only for the generated PCF start script", async () => {
  const root = "/workspace/controls/LinearInput";
  const files = new MemoryWorkspaceFiles("/workspace");
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
  const service = new PcfBuildService(npm as any, createStatusBarStub(), files);
  const project = createProject(root);

  try {
    const ok = await service.startWatch(project);

    assert.strictEqual(ok, true);
    assert.deepStrictEqual(calls, [["watch"]]);
    assert.strictEqual(service.isWatching(project), true);
  } finally {
    service.dispose();
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
