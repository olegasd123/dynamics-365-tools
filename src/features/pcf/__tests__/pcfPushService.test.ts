import assert from "node:assert";
import test from "node:test";
import * as path from "path";
import { PcfControlProject } from "../models";
import { PcfPushService, validatePublisherPrefix } from "../pcfPushService";

test("validatePublisherPrefix enforces pac publisher prefix rules", () => {
  assert.strictEqual(validatePublisherPrefix("ab"), undefined);
  assert.strictEqual(validatePublisherPrefix("a1234567"), undefined);
  assert.match(validatePublisherPrefix("a") ?? "", /2-8/);
  assert.match(validatePublisherPrefix("1abc") ?? "", /Start with a letter/);
  assert.match(validatePublisherPrefix("mscrmX") ?? "", /mscrm/);
});

test("PcfPushService pushes with selected environment and persists prefix", async () => {
  const calls: Array<{ environmentUrl: string; publisherPrefix: string; cwd: string }> = [];
  const updates: unknown[] = [];
  const pac = {
    pcfPush: async (opts: { environmentUrl: string; publisherPrefix: string }, cwd: string) => {
      calls.push({ ...opts, cwd });
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
      };
    },
  };
  const settings = {
    updateProjectSettings: async (_project: PcfControlProject, update: unknown) => {
      updates.push(update);
    },
  };
  const service = new PcfPushService(pac as any, settings as any);
  const project = createProject("/tmp/control");

  const ok = await service.push(
    project,
    { name: "dev", url: "https://dev.crm.dynamics.com" },
    "contoso",
  );

  assert.strictEqual(ok, true);
  assert.deepStrictEqual(calls, [
    {
      environmentUrl: "https://dev.crm.dynamics.com",
      publisherPrefix: "contoso",
      cwd: "/tmp/control",
    },
  ]);
  assert.deepStrictEqual(updates, [{ publisherPrefix: "contoso", lastDeployedEnv: "dev" }]);
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
