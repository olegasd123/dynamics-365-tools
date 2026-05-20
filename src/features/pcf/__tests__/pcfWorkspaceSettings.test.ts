import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ConfigurationService } from "../../config/configurationService";
import { PcfControlProject } from "../models";
import { PcfWorkspaceSettingsService } from "../pcfWorkspaceSettings";

test("PcfWorkspaceSettingsService stores project settings by workspace-relative path", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-settings-"));
  const previousFolders = vscode.workspace.workspaceFolders;
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];
  const service = new PcfWorkspaceSettingsService(new ConfigurationService());
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
    (vscode.workspace as any).workspaceFolders = previousFolders;
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
