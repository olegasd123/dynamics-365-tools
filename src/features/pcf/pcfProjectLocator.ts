import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { PcfControlProject, PcfTemplateKind } from "./models";
import { PcfManifestReader } from "./pcfManifestReader";

const MANIFEST_FILENAME = "ControlManifest.Input.xml";
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".vscode",
  "node_modules",
  "out",
  "dist",
  "bin",
  "obj",
]);

export class PcfProjectLocator implements vscode.Disposable {
  private projects: PcfControlProject[] = [];
  private watcher?: vscode.FileSystemWatcher;
  private initializePromise?: Promise<void>;
  private readonly onDidChangeProjectsEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeProjects = this.onDidChangeProjectsEmitter.event;

  constructor(private readonly manifestReader = new PcfManifestReader()) {}

  async initialize(): Promise<void> {
    this.initializePromise ??= this.doInitialize();
    await this.initializePromise;
  }

  private async doInitialize(): Promise<void> {
    await this.refresh();
    this.startWatching();
  }

  getProjects(): PcfControlProject[] {
    return this.projects.slice();
  }

  async refresh(): Promise<PcfControlProject[]> {
    const manifests = await this.findManifestUris();
    const projects: PcfControlProject[] = [];

    for (const manifestUri of manifests) {
      try {
        projects.push(await this.createProject(manifestUri));
      } catch (error) {
        void vscode.window.showWarningMessage(
          `Failed to read PCF manifest ${manifestUri.fsPath}: ${String(error)}`,
        );
      }
    }

    this.projects = projects.sort((a, b) =>
      a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }),
    );
    this.onDidChangeProjectsEmitter.fire();
    return this.getProjects();
  }

  dispose(): void {
    this.watcher?.dispose();
    this.onDidChangeProjectsEmitter.dispose();
  }

  private async createProject(manifestUri: vscode.Uri): Promise<PcfControlProject> {
    const manifestRoot = path.dirname(manifestUri.fsPath);
    const rootUri = await resolveProjectRoot(manifestRoot);
    const manifestContent = await fs.readFile(manifestUri.fsPath, "utf8");
    const manifest = this.manifestReader.read(manifestContent);
    const packageJson = await readJsonFile(path.join(rootUri, "package.json"));
    const pcfConfig = await readJsonFile(path.join(rootUri, "pcfconfig.json"));
    const outputDir = resolveOutputDir(rootUri, manifest.constructor, pcfConfig);

    return {
      rootUri,
      manifestUri: manifestUri.fsPath,
      namespace: manifest.namespace,
      constructor: manifest.constructor,
      fullName: `${manifest.namespace}.${manifest.constructor}`,
      version: manifest.version,
      controlType: manifest.controlType,
      displayName: manifest.displayName,
      description: manifest.description,
      templateKind: detectTemplateKind(packageJson),
      outputDir,
      hasNodeModules: await exists(path.join(rootUri, "node_modules")),
      cdsProjectUri: await findNearestCdsProject(rootUri),
    };
  }

  private async findManifestUris(): Promise<vscode.Uri[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const manifests: vscode.Uri[] = [];

    for (const folder of folders) {
      const matches = await findManifests(folder.uri.fsPath);
      manifests.push(...matches.map((filePath) => vscode.Uri.file(filePath)));
    }

    return manifests;
  }

  private startWatching(): void {
    if (this.watcher || !vscode.workspace.createFileSystemWatcher) {
      return;
    }

    this.watcher = vscode.workspace.createFileSystemWatcher(`**/${MANIFEST_FILENAME}`);
    const refresh = () => {
      void this.refresh();
    };
    this.watcher.onDidCreate(refresh);
    this.watcher.onDidChange(refresh);
    this.watcher.onDidDelete(refresh);
  }
}

async function findManifests(root: string): Promise<string[]> {
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
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(fullPath);
        }
      } else if (entry.isFile() && entry.name === MANIFEST_FILENAME) {
        manifests.push(fullPath);
      }
    }
  }

  await visit(root);
  return manifests;
}

async function readJsonFile(filePath: string): Promise<unknown | undefined> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

function detectTemplateKind(packageJson: unknown): PcfTemplateKind {
  if (!isRecord(packageJson)) {
    return "unknown";
  }

  const deps = {
    ...readRecord(packageJson.dependencies),
    ...readRecord(packageJson.devDependencies),
  };

  return deps.react || deps["@fluentui/react"] ? "react" : "ts";
}

function resolveOutputDir(rootUri: string, controlName: string, pcfConfig: unknown): string {
  if (isRecord(pcfConfig) && typeof pcfConfig.outDir === "string" && pcfConfig.outDir.trim()) {
    return path.resolve(rootUri, pcfConfig.outDir);
  }

  return path.join(rootUri, "out", "controls", controlName);
}

async function resolveProjectRoot(manifestRoot: string): Promise<string> {
  const pcfProjectRoot = await findNearestDirectoryWithFile(manifestRoot, (name) =>
    name.endsWith(".pcfproj"),
  );
  if (pcfProjectRoot) {
    return pcfProjectRoot;
  }

  return (
    (await findNearestDirectoryWithFile(manifestRoot, (name) => name === "package.json")) ??
    manifestRoot
  );
}

async function findNearestDirectoryWithFile(
  startDir: string,
  matches: (name: string) => boolean,
): Promise<string | undefined> {
  let current = startDir;

  while (true) {
    const entries = await listDirectoryEntries(current);
    if (entries.some((entry) => entry.isFile() && matches(entry.name))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function findNearestCdsProject(projectRoot: string): Promise<string | undefined> {
  let current = projectRoot;
  while (true) {
    const cdsProjects = await listCdsProjects(current);
    if (cdsProjects.length) {
      return cdsProjects[0];
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function listCdsProjects(dir: string): Promise<string[]> {
  const entries = await listDirectoryEntries(dir);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".cdsproj"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

async function listDirectoryEntries(dir: string): Promise<Array<import("fs").Dirent>> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
