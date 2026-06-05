import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { NodeWorkspaceFiles } from "../../../testSupport/fakes";
import { ConfigurationService } from "../../config/configurationService";
import { PcfControlProject } from "../models";
import { PcfPackageService, parseSolutionZipPath } from "../pcfPackageService";
import { PcfWorkspaceSettingsService } from "../pcfWorkspaceSettings";

test("parseSolutionZipPath resolves the last zip mentioned in build output", () => {
  const result = parseSolutionZipPath(
    [
      "Restored something.zipless",
      "Solution package: bin/Release/Contoso_managed.zip",
      "Done",
    ].join("\n"),
    "/tmp/solution",
  );

  assert.strictEqual(result, path.join("/tmp/solution", "bin", "Release", "Contoso_managed.zip"));
});

test("PcfPackageService reuses an existing cdsproj and persists the packaged zip", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-package-"));
  const files = new NodeWorkspaceFiles(workspaceRoot);

  const controlRoot = path.join(workspaceRoot, "controls", "LinearInput");
  const solutionRoot = path.join(workspaceRoot, "solution");
  const pcfProject = path.join(controlRoot, "LinearInput.pcfproj");
  const cdsProject = path.join(solutionRoot, "ContosoSolution.cdsproj");
  await fs.mkdir(controlRoot, { recursive: true });
  await fs.mkdir(path.join(solutionRoot, "src", "Other"), { recursive: true });
  await fs.writeFile(pcfProject, "<Project />");
  await fs.writeFile(
    cdsProject,
    `<Project><ItemGroup><ProjectReference Include="../controls/LinearInput/LinearInput.pcfproj" /></ItemGroup></Project>`,
  );
  await fs.writeFile(
    path.join(solutionRoot, "src", "Other", "Solution.xml"),
    "<ImportExportXml><SolutionManifest><Publisher><CustomizationPrefix>contoso</CustomizationPrefix></Publisher></SolutionManifest></ImportExportXml>",
  );

  const runnerCalls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const runner = {
    run: async (command: string, args: string[], options: { cwd?: string }) => {
      runnerCalls.push({ command, args, cwd: options.cwd });
      return {
        exitCode: 0,
        stdout: `Created ${path.join(solutionRoot, "bin", "Release", "ContosoSolution.zip")}`,
        stderr: "",
        durationMs: 42,
      };
    },
  };
  const pac = {
    detect: async () => ({ available: true, version: "1.0.0" }),
    solutionInit: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 }),
    solutionAddReference: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 }),
  };

  try {
    const configuration = new ConfigurationService(files);
    const settings = new PcfWorkspaceSettingsService(configuration, files);
    const service = new PcfPackageService(pac as any, runner as any, settings, configuration);
    const project = createProject(controlRoot, cdsProject);

    const result = await service.packageControl(project, { managed: true });

    assert.strictEqual(
      result?.zipPath,
      path.join(solutionRoot, "bin", "Release", "ContosoSolution.zip"),
    );
    assert.deepStrictEqual(runnerCalls, [
      {
        command: "dotnet",
        args: ["build", cdsProject, "/p:configuration=Release", "/p:managed=true"],
        cwd: solutionRoot,
      },
    ]);
    const stored = await settings.getProjectSettings(project);
    assert.strictEqual(stored.lastPackagedZip, "solution/bin/Release/ContosoSolution.zip");
    assert.strictEqual(stored.publisherPrefix, "contoso");
    service.dispose();
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

function createProject(rootUri: string, cdsProjectUri: string): PcfControlProject {
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
    cdsProjectUri,
  };
}
