import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { XMLParser } from "fast-xml-parser";
import type { CommandContext } from "../../../app/commandContext";
import type { PcfControlProject } from "../models";
import { detectTool } from "../pacCli";
import { PcfControlProjectNode } from "../pcfExplorer";

type WorkspaceFolderPick = vscode.QuickPickItem & {
  folder: vscode.WorkspaceFolder;
};

const MANIFEST_FILENAME = "ControlManifest.Input.xml";
const PCF_AJV_VERSION = "^8.20.0";
const PCF_ESLINT_VERSION = "^9.34.0";
const PCF_TYPES_PACKAGE = "powerapps-component-framework";
const IGNORED_GENERATED_DIRECTORIES = new Set([
  ".git",
  ".vscode",
  "bin",
  "dist",
  "node_modules",
  "obj",
  "out",
]);

export async function refreshPcfExplorer(ctx: CommandContext): Promise<void> {
  await ctx.pcfProjectLocator.refresh();
  ctx.pcfExplorer.refresh();
}

export async function newPcfControl(ctx: CommandContext): Promise<void> {
  if (!(await ensurePac(ctx))) {
    return;
  }

  const parentFolder = await pickParentFolder();
  if (!parentFolder) {
    return;
  }

  const namespace = await vscode.window.showInputBox({
    prompt: "Namespace",
    placeHolder: "Contoso.Controls",
    ignoreFocusOut: true,
    validateInput: validateNamespace,
  });
  if (!namespace) {
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: "Control name",
    placeHolder: "LinearInput",
    ignoreFocusOut: true,
    validateInput: (value) => validateNewPcfControlName(value, parentFolder.uri.fsPath),
  });
  if (!name) {
    return;
  }

  const template = await vscode.window.showQuickPick(
    [
      { label: "field", description: "Field control" },
      { label: "dataset", description: "Dataset control" },
    ],
    { placeHolder: "Select PCF template" },
  );
  if (!template) {
    return;
  }

  const framework = await vscode.window.showQuickPick(
    [
      { label: "none", description: "TypeScript" },
      { label: "react", description: "React" },
    ],
    { placeHolder: "Select framework" },
  );
  if (!framework) {
    return;
  }

  const install = await vscode.window.showQuickPick(
    [
      { label: "Run npm install", runNpmInstall: true },
      { label: "Skip npm install", runNpmInstall: false },
    ],
    { placeHolder: "Install dependencies after scaffold?" },
  );
  if (!install) {
    return;
  }

  if (install.runNpmInstall && !(await ensureNpm(ctx))) {
    return;
  }

  const targetRoot = path.join(parentFolder.uri.fsPath, name.trim());
  if (await isNonEmptyDirectory(targetRoot)) {
    vscode.window.showErrorMessage(`Folder ${targetRoot} already exists and is not empty.`);
    return;
  }

  const output = vscode.window.createOutputChannel("PCF: New Control");
  output.show(true);
  output.appendLine(`[${new Date().toISOString()}] Create ${namespace.trim()}.${name.trim()}`);

  await fs.mkdir(targetRoot, { recursive: true });
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Creating PCF control ${name.trim()}`,
      cancellable: true,
    },
    async (_progress, token) =>
      ctx.pacCli.pcfInit(
        {
          namespace: namespace.trim(),
          name: name.trim(),
          template: template.label as "field" | "dataset",
          framework: framework.label as "none" | "react",
          runNpmInstall: false,
        },
        targetRoot,
        (line, stream) => output.appendLine(stream === "stderr" ? `[stderr] ${line}` : line),
        token,
      ),
  );

  if (result.exitCode !== 0) {
    output.appendLine(`pac exited with code ${result.exitCode}.`);
    await removeEmptyDirectory(targetRoot);
    vscode.window.showErrorMessage(
      `Failed to create PCF control ${name.trim()}. See PCF: New Control output.`,
    );
    return;
  }

  const normalizeResult = await normalizeGeneratedPcfProject(targetRoot);
  if (normalizeResult.tsConfigChanged) {
    output.appendLine("Updated tsconfig.json for current TypeScript versions.");
  }
  if (normalizeResult.packageJsonChanged) {
    output.appendLine("Updated package.json for PCF build dependencies.");
  }

  if (install.runNpmInstall) {
    const installResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Installing dependencies for ${name.trim()}`,
        cancellable: true,
      },
      async (_progress, token) => {
        output.appendLine("Running npm install...");
        return ctx.pcfProcessRunner.run("npm", ["install"], {
          cwd: targetRoot,
          onLine: (line, stream) =>
            output.appendLine(stream === "stderr" ? `[stderr] ${line}` : line),
          token,
        });
      },
    );

    if (installResult.exitCode !== 0) {
      output.appendLine(`npm install exited with code ${installResult.exitCode}.`);
      vscode.window.showWarningMessage(
        `PCF control ${namespace.trim()}.${name.trim()} was created, but npm install failed. See PCF: New Control output.`,
      );
    }
  }

  await refreshPcfExplorer(ctx);
  const sourceFile = await findGeneratedPcfSourceFile(targetRoot, name.trim());
  if (sourceFile) {
    await vscode.window.showTextDocument(vscode.Uri.file(sourceFile));
  } else {
    vscode.window.showWarningMessage(
      `PCF control ${namespace.trim()}.${name.trim()} was created, but no source file was found.`,
    );
  }
  vscode.window.showInformationMessage(`PCF control ${namespace.trim()}.${name.trim()} created.`);
}

export async function openPcfManifest(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): Promise<void> {
  const uri = resolveManifestUri(ctx, nodeOrUri);
  if (!uri) {
    void vscode.window.showWarningMessage("Select a PCF control manifest first.");
    return;
  }

  await vscode.window.showTextDocument(uri);
}

export async function editPcfConfig(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): Promise<void> {
  const project = await resolveProject(ctx, nodeOrUri);
  if (!project) {
    return;
  }

  const configPath = path.join(project.rootUri, "pcfconfig.json");
  if (!(await exists(configPath))) {
    const defaultConfig = {
      outDir: normalizeSlashes(path.relative(project.rootUri, project.outputDir)),
    };
    await fs.writeFile(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf8");
  }

  await vscode.window.showTextDocument(vscode.Uri.file(configPath));
}

export async function buildPcfControl(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): Promise<void> {
  if (!(await ensureNpm(ctx))) {
    return;
  }

  const project = await resolveProject(ctx, nodeOrUri);
  if (!project) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Building ${project.fullName}`,
      cancellable: true,
    },
    async (_progress, token) => {
      const ok = await ctx.pcfBuildService.build(project, { token });
      if (ok) {
        await ctx.pcfProjectLocator.refresh();
        ctx.pcfExplorer.refresh();
      }
    },
  );
}

export async function watchPcfControl(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): Promise<void> {
  if (!(await ensureNpm(ctx))) {
    return;
  }

  const project = await resolveProject(ctx, nodeOrUri);
  if (!project) {
    return;
  }

  await ctx.pcfBuildService.startWatch(project);
}

export async function pushPcfControl(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): Promise<void> {
  if (!(await ensurePac(ctx))) {
    return;
  }

  const project = await resolveProject(ctx, nodeOrUri);
  if (!project) {
    return;
  }

  const config = await ctx.configuration.loadConfiguration();
  const env = await ctx.ui.pickEnvironment(
    config.environments,
    ctx.lastSelection.getLastEnvironment(),
    { placeHolder: "Select environment for PCF push" },
  );
  if (!env) {
    return;
  }

  await ctx.lastSelection.setLastEnvironment(env.name);
  const publisherPrefix = await ctx.pcfPushService.resolvePublisherPrefix(project);
  if (!publisherPrefix) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Pushing ${project.fullName} to ${env.name}`,
      cancellable: true,
    },
    async (_progress, token) => {
      const canContinue = await ctx.pcfPushService.warnForAuthMismatch(env, token);
      if (!canContinue) {
        return;
      }

      const ok = await ctx.pcfPushService.push(project, env, publisherPrefix, token);
      if (ok) {
        await ctx.pcfProjectLocator.refresh();
        ctx.pcfExplorer.refresh();
      }
    },
  );
}

export async function stopPcfWatch(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): Promise<void> {
  const project = await resolveProject(ctx, nodeOrUri, { allowPick: false });
  ctx.pcfBuildService.stopWatch(project);
}

export async function normalizeGeneratedPcfTsConfig(projectRoot: string): Promise<boolean> {
  const tsConfigPath = path.join(projectRoot, "tsconfig.json");
  let parsed: unknown;

  try {
    parsed = JSON.parse(await fs.readFile(tsConfigPath, "utf8"));
  } catch {
    return false;
  }

  if (!isRecord(parsed)) {
    return false;
  }

  const compilerOptions = isRecord(parsed.compilerOptions) ? parsed.compilerOptions : {};
  let changed = false;

  if (!isRecord(parsed.compilerOptions)) {
    parsed.compilerOptions = compilerOptions;
    changed = true;
  }

  if (shouldUseBundlerModuleResolution(compilerOptions.moduleResolution)) {
    compilerOptions.moduleResolution = "bundler";
    changed = true;
  }

  if (ensureTypePackage(compilerOptions, PCF_TYPES_PACKAGE)) {
    changed = true;
  }

  if (!changed) {
    return false;
  }

  await fs.writeFile(tsConfigPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return true;
}

export interface PcfScaffoldNormalizeResult {
  tsConfigChanged: boolean;
  packageJsonChanged: boolean;
}

export async function normalizeGeneratedPcfProject(
  projectRoot: string,
): Promise<PcfScaffoldNormalizeResult> {
  const [tsConfigChanged, packageJsonChanged] = await Promise.all([
    normalizeGeneratedPcfTsConfig(projectRoot),
    normalizeGeneratedPcfPackageJson(projectRoot),
  ]);

  return {
    tsConfigChanged,
    packageJsonChanged,
  };
}

export async function normalizeGeneratedPcfPackageJson(projectRoot: string): Promise<boolean> {
  const packageJsonPath = path.join(projectRoot, "package.json");
  let parsed: unknown;

  try {
    parsed = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  } catch {
    return false;
  }

  if (!isRecord(parsed)) {
    return false;
  }

  const devDependencies = isRecord(parsed.devDependencies) ? parsed.devDependencies : {};
  let changed = false;

  if (!isRecord(parsed.devDependencies)) {
    parsed.devDependencies = devDependencies;
    changed = true;
  }

  if (devDependencies.eslint === undefined) {
    devDependencies.eslint = PCF_ESLINT_VERSION;
    changed = true;
  }

  if (devDependencies.ajv === undefined) {
    devDependencies.ajv = PCF_AJV_VERSION;
    changed = true;
  }

  if (!changed) {
    return false;
  }

  await fs.writeFile(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return true;
}

function resolveManifestUri(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): vscode.Uri | undefined {
  if (nodeOrUri instanceof PcfControlProjectNode) {
    return vscode.Uri.file(nodeOrUri.project.manifestUri);
  }

  if (nodeOrUri instanceof vscode.Uri) {
    return nodeOrUri;
  }

  const editorUri = vscode.window.activeTextEditor?.document.uri;
  if (editorUri?.fsPath.endsWith("ControlManifest.Input.xml")) {
    return editorUri;
  }

  const firstProject = ctx.pcfProjectLocator.getProjects()[0];
  return firstProject ? vscode.Uri.file(firstProject.manifestUri) : undefined;
}

export async function resolvePcfProject(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
  options: { allowPick?: boolean } = {},
): Promise<PcfControlProject | undefined> {
  if (nodeOrUri instanceof PcfControlProjectNode) {
    return nodeOrUri.project;
  }

  const projects = ctx.pcfProjectLocator.getProjects();
  const uri =
    nodeOrUri instanceof vscode.Uri ? nodeOrUri : vscode.window.activeTextEditor?.document.uri;
  if (uri) {
    const matched = projects.find((project) => isInsideProject(uri.fsPath, project));
    if (matched) {
      return matched;
    }
  }

  if (projects.length === 1) {
    return projects[0];
  }

  if (options.allowPick === false) {
    return undefined;
  }

  const pick = await vscode.window.showQuickPick(
    projects.map((project) => ({
      label: project.fullName,
      description: project.rootUri,
      project,
    })),
    { placeHolder: "Select PCF control" },
  );
  if (!pick) {
    if (!projects.length) {
      vscode.window.showWarningMessage("No PCF controls found in this workspace.");
    }
    return undefined;
  }

  return pick.project;
}

const resolveProject = resolvePcfProject;

async function pickParentFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length) {
    vscode.window.showErrorMessage("Open a workspace folder before creating a PCF control.");
    return undefined;
  }

  if (folders.length === 1) {
    return folders[0];
  }

  const pick = await vscode.window.showQuickPick<WorkspaceFolderPick>(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    { placeHolder: "Select parent workspace folder" },
  );
  return pick?.folder;
}

async function ensurePac(ctx: CommandContext): Promise<boolean> {
  const result = await ctx.pacCli.detect();
  if (result.available) {
    return true;
  }

  const action = await vscode.window.showErrorMessage(
    `Power Platform CLI is required for PCF commands: ${result.error ?? "pac not found"}.`,
    "Install pac CLI",
  );
  if (action === "Install pac CLI") {
    await vscode.env.openExternal(
      vscode.Uri.parse("https://learn.microsoft.com/power-platform/developer/cli/introduction"),
    );
  }
  return false;
}

async function ensureNpm(ctx: CommandContext): Promise<boolean> {
  const result = await detectTool(ctx.pcfProcessRunner, "npm", ["--version"]);
  if (result.available) {
    return true;
  }

  vscode.window.showErrorMessage(
    `npm is required for this PCF command: ${result.error ?? "npm not found"}.`,
  );
  return false;
}

function validateNamespace(value: string): string | undefined {
  if (!value.trim()) {
    return "Namespace is required.";
  }
  if (!/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/.test(value.trim())) {
    return "Use letters, numbers, and dots. Each part must start with a letter.";
  }
  return undefined;
}

function validateControlName(value: string): string | undefined {
  if (!value.trim()) {
    return "Control name is required.";
  }
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(value.trim())) {
    return "Use letters and numbers. The first character must be a letter.";
  }
  return undefined;
}

export async function validateNewPcfControlName(
  value: string,
  parentFolderPath: string,
): Promise<string | undefined> {
  const basicError = validateControlName(value);
  if (basicError) {
    return basicError;
  }

  const targetRoot = path.join(parentFolderPath, value.trim());
  if (await isNonEmptyDirectory(targetRoot)) {
    return `Folder ${targetRoot} already exists and is not empty.`;
  }

  return undefined;
}

async function isNonEmptyDirectory(folderPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory()) {
      return true;
    }
    const entries = await fs.readdir(folderPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function removeEmptyDirectory(folderPath: string): Promise<void> {
  try {
    await fs.rmdir(folderPath);
  } catch {
    // Keep folders with generated files or folders we cannot remove.
  }
}

export async function findGeneratedPcfSourceFile(
  projectRoot: string,
  controlName: string,
): Promise<string | undefined> {
  const directCandidates = [
    path.join(projectRoot, controlName, "index.ts"),
    path.join(projectRoot, "index.ts"),
  ];

  for (const candidate of directCandidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  const manifests = await findGeneratedManifests(projectRoot);
  for (const manifestPath of manifests) {
    const codePath = await readFirstCodeResourcePath(manifestPath);
    const candidate = path.resolve(path.dirname(manifestPath), codePath ?? "index.ts");
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function findGeneratedManifests(root: string): Promise<string[]> {
  const manifests: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: Array<import("fs").Dirent>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_GENERATED_DIRECTORIES.has(entry.name)) {
          await visit(fullPath);
        }
      } else if (entry.isFile() && entry.name === MANIFEST_FILENAME) {
        manifests.push(fullPath);
      }
    }
  }

  await visit(root);
  return manifests.sort();
}

async function readFirstCodeResourcePath(manifestPath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(manifestPath, "utf8");
    const parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      allowBooleanAttributes: true,
    }).parse(content) as unknown;
    const control = findControlNode(parsed);
    const resources = isRecord(control?.resources) ? control.resources : undefined;
    const codeResources = asArray(resources?.code).filter(isRecord);
    return readAttribute(codeResources[0], "path");
  } catch {
    return undefined;
  }
}

function findControlNode(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const manifest = value.manifest;
  if (isRecord(manifest) && isRecord(manifest.control)) {
    return manifest.control;
  }

  return isRecord(value.control) ? value.control : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function readAttribute(value: unknown, name: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const attribute = value[`@_${name}`] ?? value[name];
  return typeof attribute === "string" && attribute.trim() ? attribute.trim() : undefined;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function isInsideProject(filePath: string, project: PcfControlProject): boolean {
  const relative = path.relative(project.rootUri, filePath);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function shouldUseBundlerModuleResolution(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  return ["node", "node10"].includes(value.toLowerCase());
}

function ensureTypePackage(compilerOptions: Record<string, unknown>, packageName: string): boolean {
  const types = compilerOptions.types;
  if (types === undefined) {
    compilerOptions.types = [packageName];
    return true;
  }

  if (!Array.isArray(types) || !types.every((item) => typeof item === "string")) {
    return false;
  }

  if (types.includes(packageName)) {
    return false;
  }

  types.push(packageName);
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
