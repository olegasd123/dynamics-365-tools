import assert from "node:assert";
import test from "node:test";
import * as path from "path";
import { MemoryWorkspaceFiles, RecordingTextInput } from "../../../testSupport/fakes";
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
  const files = new MemoryWorkspaceFiles("/workspace");
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
  const service = new PcfPushService(pac as any, settings as any, files);
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

test("PcfPushService syncs pac auth when the profile targets another environment", async () => {
  const files = new MemoryWorkspaceFiles("/workspace");
  const authCreates: unknown[] = [];
  const pac = {
    whoami: async () => ({ url: "https://other.crm.dynamics.com" }),
    authCreate: async (opts: unknown) => {
      authCreates.push(opts);
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
      };
    },
  };
  const service = new PcfPushService(pac as any, {} as any, files);

  const ok = await service.warnForAuthMismatch({
    name: "dev",
    url: "https://dev.crm.dynamics.com",
  });

  assert.strictEqual(ok, true);
  assert.deepStrictEqual(authCreates, [
    { url: "https://dev.crm.dynamics.com", name: "d365-tools" },
  ]);
});

test("PcfPushService does not sync pac auth when profile matches selected environment", async () => {
  const files = new MemoryWorkspaceFiles("/workspace");
  let authCreateCalls = 0;
  const pac = {
    whoami: async () => ({ url: "https://dev.crm.dynamics.com/" }),
    authCreate: async () => {
      authCreateCalls += 1;
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
      };
    },
  };
  const service = new PcfPushService(pac as any, {} as any, files);

  const ok = await service.warnForAuthMismatch({
    name: "dev",
    url: "https://dev.crm.dynamics.com",
  });

  assert.strictEqual(ok, true);
  assert.strictEqual(authCreateCalls, 0);
});

test("PcfPushService resolves publisher prefix from cds solution metadata", async () => {
  const files = new MemoryWorkspaceFiles("/workspace");
  const cdsProjectUri = "/workspace/solution/Contoso.cdsproj";
  files.addFile(cdsProjectUri, "<Project />");
  files.addFile(
    "/workspace/solution/src/Other/Solution.xml",
    "<ImportExportXml><SolutionManifest><Publisher><CustomizationPrefix>contoso</CustomizationPrefix></Publisher></SolutionManifest></ImportExportXml>",
  );
  const updates: unknown[] = [];
  const input = new RecordingTextInput();
  const settings = {
    updateProjectSettings: async (_project: PcfControlProject, update: unknown) => {
      updates.push(update);
    },
    getProjectSettings: async () => ({}),
  };
  const service = new PcfPushService(
    {} as any,
    settings as any,
    files,
    undefined,
    undefined,
    undefined,
    input,
  );

  const prefix = await service.resolvePublisherPrefix({
    ...createProject("/workspace/controls/LinearInput"),
    cdsProjectUri,
  });

  assert.strictEqual(prefix, "contoso");
  assert.deepStrictEqual(updates, [{ publisherPrefix: "contoso" }]);
  assert.deepStrictEqual(input.prompts, []);
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
