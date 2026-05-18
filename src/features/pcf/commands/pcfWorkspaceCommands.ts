import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { PcfControlProject } from "../models";
import { detectTool } from "../pacCli";
import { PcfControlProjectNode } from "../pcfExplorer";

type WorkspaceFolderPick = vscode.QuickPickItem & {
  folder: vscode.WorkspaceFolder;
};

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
    validateInput: validateControlName,
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
          runNpmInstall: install.runNpmInstall,
        },
        targetRoot,
        (line, stream) => output.appendLine(stream === "stderr" ? `[stderr] ${line}` : line),
        token,
      ),
  );

  if (result.exitCode !== 0) {
    vscode.window.showErrorMessage(`Failed to create PCF control ${name.trim()}.`);
    return;
  }

  await refreshPcfExplorer(ctx);
  const indexUri = vscode.Uri.file(path.join(targetRoot, "index.ts"));
  await vscode.window.showTextDocument(indexUri);
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

export async function stopPcfWatch(
  ctx: CommandContext,
  nodeOrUri?: PcfControlProjectNode | vscode.Uri,
): Promise<void> {
  const project = await resolveProject(ctx, nodeOrUri, { allowPick: false });
  ctx.pcfBuildService.stopWatch(project);
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

async function resolveProject(
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

function isInsideProject(filePath: string, project: PcfControlProject): boolean {
  const relative = path.relative(project.rootUri, filePath);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}
