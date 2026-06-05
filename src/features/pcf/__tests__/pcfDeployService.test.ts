import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { NodeWorkspaceFiles } from "../../../testSupport/fakes";
import { ConfigurationService } from "../../config/configurationService";
import { DataverseClient } from "../../dataverse/dataverseClient";
import { PcfControlProject } from "../models";
import { PcfDeployService } from "../pcfDeployService";
import { PcfWorkspaceSettingsService } from "../pcfWorkspaceSettings";

test("PcfDeployService imports last packaged zip and publishes deployed custom control", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-deploy-"));
  const originalFetch = globalThis.fetch;
  const files = new NodeWorkspaceFiles(workspaceRoot);

  const zipPath = path.join(workspaceRoot, "solution", "bin", "Release", "Contoso.zip");
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  await fs.writeFile(zipPath, "zip");

  const requests: Array<{ method: string; url: string; body?: any }> = [];
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method: init?.method ?? "GET", url, body });

    if (url.endsWith("/ImportSolutionAsync")) {
      return jsonResponse({ AsyncOperationId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
    }
    if (url.includes("/asyncoperations(")) {
      return jsonResponse({ statecode: 3, statuscode: 30 });
    }
    if (url.includes("/importjobs(")) {
      return jsonResponse({ data: "<importexportxml />" });
    }
    if (url.includes("/customcontrols?")) {
      return jsonResponse({
        value: [{ customcontrolid: "11111111-2222-3333-4444-555555555555" }],
      });
    }
    if (url.endsWith("/PublishXml")) {
      return jsonResponse({});
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const configuration = new ConfigurationService(files);
    const settings = new PcfWorkspaceSettingsService(configuration, files);
    const project = createProject(path.join(workspaceRoot, "controls", "LinearInput"));
    await settings.updateProjectSettings(project, {
      lastPackagedZip: "solution/bin/Release/Contoso.zip",
    });

    const connections = {
      createConnection: async (env: any) => ({
        env,
        apiRoot: "https://org.crm.dynamics.com/api/data/v9.2",
        token: "token",
      }),
      createClient: async (env: any) =>
        new DataverseClient({
          env,
          apiRoot: "https://org.crm.dynamics.com/api/data/v9.2",
          token: "token",
        }),
    };
    const service = new PcfDeployService(connections as any, settings, configuration);
    const result = await service.deployLastPackage(
      project,
      { name: "test", url: "https://org.crm.dynamics.com" },
      { pollIntervalMs: 0 },
    );

    assert.strictEqual(result?.zipPath, zipPath);
    assert.deepStrictEqual(result?.customControlIds, ["11111111-2222-3333-4444-555555555555"]);
    assert.strictEqual(
      requests[0].url,
      "https://org.crm.dynamics.com/api/data/v9.2/ImportSolutionAsync",
    );
    assert.strictEqual(requests[0].body.CustomizationFile, Buffer.from("zip").toString("base64"));
    assert.strictEqual(requests[4].url, "https://org.crm.dynamics.com/api/data/v9.2/PublishXml");
    assert.match(requests[4].body.ParameterXml, /11111111-2222-3333-4444-555555555555/);
    const stored = await settings.getProjectSettings(project);
    assert.strictEqual(stored.lastDeployedEnv, "test");
    service.dispose();
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

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
