import assert from "node:assert";
import test from "node:test";
import * as path from "path";
import { MemoryWorkspaceFiles } from "../../../testSupport/fakes";
import { PcfProjectLocator } from "../pcfProjectLocator";

test("locates PCF projects in workspace folders", async () => {
  const workspaceRoot = "/workspace";
  const files = new MemoryWorkspaceFiles(workspaceRoot);
  const controlRoot = path.join(workspaceRoot, "controls", "LinearInput");
  files.addDirectory(path.join(controlRoot, "node_modules"));
  files.addFile(
    path.join(controlRoot, "ControlManifest.Input.xml"),
    `
      <manifest>
        <control namespace="Contoso" constructor="LinearInput" version="1.0.0" />
      </manifest>
    `,
  );
  files.addFile(
    path.join(controlRoot, "package.json"),
    JSON.stringify({ dependencies: { react: "^18.0.0" } }),
  );
  files.addFile(path.join(controlRoot, "pcfconfig.json"), JSON.stringify({ outDir: "build" }));

  const locator = new PcfProjectLocator(files);
  const projects = await locator.refresh();

  assert.strictEqual(projects.length, 1);
  assert.strictEqual(projects[0].fullName, "Contoso.LinearInput");
  assert.strictEqual(projects[0].templateKind, "react");
  assert.strictEqual(projects[0].hasNodeModules, true);
  assert.strictEqual(projects[0].outputDir, path.join(controlRoot, "build"));
  locator.dispose();
});

test("uses the PCF project folder when the manifest is in a control subfolder", async () => {
  const workspaceRoot = "/workspace";
  const files = new MemoryWorkspaceFiles(workspaceRoot);
  const projectRoot = path.join(workspaceRoot, "CustomEmail");
  const manifestRoot = path.join(projectRoot, "CustomEmail");
  files.addDirectory(path.join(projectRoot, "node_modules"));
  files.addFile(path.join(projectRoot, "CustomEmail.pcfproj"), "<Project />");
  files.addFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ dependencies: { react: "^18.0.0" } }),
  );
  files.addDirectory(manifestRoot);
  files.addFile(
    path.join(manifestRoot, "ControlManifest.Input.xml"),
    `
      <manifest>
        <control namespace="Contoso.Controls" constructor="CustomEmail" version="1.0.0" />
      </manifest>
    `,
  );

  const locator = new PcfProjectLocator(files);
  const projects = await locator.refresh();

  assert.strictEqual(projects.length, 1);
  assert.strictEqual(projects[0].rootUri, projectRoot);
  assert.strictEqual(projects[0].manifestUri, path.join(manifestRoot, "ControlManifest.Input.xml"));
  assert.strictEqual(projects[0].templateKind, "react");
  assert.strictEqual(projects[0].hasNodeModules, true);
  assert.strictEqual(
    projects[0].outputDir,
    path.join(projectRoot, "out", "controls", "CustomEmail"),
  );
  locator.dispose();
});

test("locator ignores node_modules manifests", async () => {
  const workspaceRoot = "/workspace";
  const files = new MemoryWorkspaceFiles(workspaceRoot);
  const ignoredRoot = path.join(workspaceRoot, "node_modules", "IgnoredControl");
  files.addDirectory(ignoredRoot);
  files.addFile(
    path.join(ignoredRoot, "ControlManifest.Input.xml"),
    `
      <manifest>
        <control namespace="Contoso" constructor="Ignored" version="1.0.0" />
      </manifest>
    `,
  );

  const locator = new PcfProjectLocator(files);
  const projects = await locator.refresh();

  assert.deepStrictEqual(projects, []);
  locator.dispose();
});
