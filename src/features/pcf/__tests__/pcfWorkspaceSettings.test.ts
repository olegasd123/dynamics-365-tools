import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { NodeWorkspaceFiles } from "../../../testSupport/fakes";
import { ConfigurationService } from "../../config/configurationService";
import { PcfControlProject } from "../models";
import { PcfWorkspaceSettingsService } from "../pcfWorkspaceSettings";

test("PcfWorkspaceSettingsService stores project settings by workspace-relative path", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-settings-"));
  const files = new NodeWorkspaceFiles(workspaceRoot);
  const service = new PcfWorkspaceSettingsService(new ConfigurationService(files), files);
  const project = createProject(path.join(workspaceRoot, "controls", "LinearInput"));

  try {
    await service.updateProjectSettings(project, {
      publisherPrefix: "contoso",
      lastDeployedEnv: "dev",
    });

    const settings = await service.load();
    assert.deepStrictEqual(settings.projects["controls/LinearInput"], {
      publisherPrefix: "contoso",
      lastDeployedEnv: "dev",
    });
    await fs.stat(path.join(workspaceRoot, ".vscode", "dynamics365tools.pcf.json"));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
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
