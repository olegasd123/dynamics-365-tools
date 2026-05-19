import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { PcfProjectLocator } from "../pcfProjectLocator";

test("locates PCF projects in workspace folders", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-"));
  const controlRoot = path.join(workspaceRoot, "controls", "LinearInput");
  await fs.mkdir(path.join(controlRoot, "node_modules"), { recursive: true });
  await fs.writeFile(
    path.join(controlRoot, "ControlManifest.Input.xml"),
    `
      <manifest>
        <control namespace="Contoso" constructor="LinearInput" version="1.0.0" />
      </manifest>
    `,
  );
  await fs.writeFile(
    path.join(controlRoot, "package.json"),
    JSON.stringify({ dependencies: { react: "^18.0.0" } }),
  );
  await fs.writeFile(path.join(controlRoot, "pcfconfig.json"), JSON.stringify({ outDir: "build" }));

  const previousFolders = vscode.workspace.workspaceFolders;
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];

  try {
    const locator = new PcfProjectLocator();
    const projects = await locator.refresh();

    assert.strictEqual(projects.length, 1);
    assert.strictEqual(projects[0].fullName, "Contoso.LinearInput");
    assert.strictEqual(projects[0].templateKind, "react");
    assert.strictEqual(projects[0].hasNodeModules, true);
    assert.strictEqual(projects[0].outputDir, path.join(controlRoot, "build"));
    locator.dispose();
  } finally {
    (vscode.workspace as any).workspaceFolders = previousFolders;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("uses the PCF project folder when the manifest is in a control subfolder", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-"));
  const projectRoot = path.join(workspaceRoot, "CustomEmail");
  const manifestRoot = path.join(projectRoot, "CustomEmail");
  await fs.mkdir(path.join(projectRoot, "node_modules"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "CustomEmail.pcfproj"), "<Project />");
  await fs.writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ dependencies: { react: "^18.0.0" } }),
  );
  await fs.mkdir(manifestRoot, { recursive: true });
  await fs.writeFile(
    path.join(manifestRoot, "ControlManifest.Input.xml"),
    `
      <manifest>
        <control namespace="Contoso.Controls" constructor="CustomEmail" version="1.0.0" />
      </manifest>
    `,
  );

  const previousFolders = vscode.workspace.workspaceFolders;
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];

  try {
    const locator = new PcfProjectLocator();
    const projects = await locator.refresh();

    assert.strictEqual(projects.length, 1);
    assert.strictEqual(projects[0].rootUri, projectRoot);
    assert.strictEqual(
      projects[0].manifestUri,
      path.join(manifestRoot, "ControlManifest.Input.xml"),
    );
    assert.strictEqual(projects[0].templateKind, "react");
    assert.strictEqual(projects[0].hasNodeModules, true);
    assert.strictEqual(
      projects[0].outputDir,
      path.join(projectRoot, "out", "controls", "CustomEmail"),
    );
    locator.dispose();
  } finally {
    (vscode.workspace as any).workspaceFolders = previousFolders;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("locator ignores node_modules manifests", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-"));
  const ignoredRoot = path.join(workspaceRoot, "node_modules", "IgnoredControl");
  await fs.mkdir(ignoredRoot, { recursive: true });
  await fs.writeFile(
    path.join(ignoredRoot, "ControlManifest.Input.xml"),
    `
      <manifest>
        <control namespace="Contoso" constructor="Ignored" version="1.0.0" />
      </manifest>
    `,
  );

  const previousFolders = vscode.workspace.workspaceFolders;
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];

  try {
    const locator = new PcfProjectLocator();
    const projects = await locator.refresh();

    assert.deepStrictEqual(projects, []);
    locator.dispose();
  } finally {
    (vscode.workspace as any).workspaceFolders = previousFolders;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
