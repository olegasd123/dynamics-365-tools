import * as path from "path";
import { WorkspaceFileType } from "../../app/ports/files";
import type { WorkspaceDirectoryEntry, WorkspaceFilesPort } from "../../app/ports/files";
import { NoopNotificationService, NotificationPort } from "../../app/ports/notifications";
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

type Disposable = { dispose(): void };
type EventListener<T> = (event: T) => void;
export type PcfProjectWatch = (listener: () => void) => Disposable | undefined;

export class PcfProjectLocator implements Disposable {
  private projects: PcfControlProject[] = [];
  private watcher?: Disposable;
  private initializePromise?: Promise<void>;
  private readonly onDidChangeProjectsEmitter = new SimpleEventEmitter<void>();
  readonly onDidChangeProjects = this.onDidChangeProjectsEmitter.event;

  constructor(
    private readonly files: WorkspaceFilesPort,
    private readonly manifestReader = new PcfManifestReader(),
    private readonly notifications: NotificationPort = new NoopNotificationService(),
    private readonly watchManifests?: PcfProjectWatch,
  ) {}

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
    const manifests = await this.findManifestPaths();
    const projects: PcfControlProject[] = [];

    for (const manifestPath of manifests) {
      try {
        projects.push(await this.createProject(manifestPath));
      } catch (error) {
        void this.notifications.warning(
          `Failed to read PCF manifest ${manifestPath}: ${String(error)}`,
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

  private async createProject(manifestPath: string): Promise<PcfControlProject> {
    const manifestRoot = path.dirname(manifestPath);
    const rootUri = await resolveProjectRoot(this.files, manifestRoot);
    const manifestContent = Buffer.from(await this.files.readFile(manifestPath)).toString("utf8");
    const manifest = this.manifestReader.read(manifestContent);
    const packageJson = await readJsonFile(this.files, path.join(rootUri, "package.json"));
    const pcfConfig = await readJsonFile(this.files, path.join(rootUri, "pcfconfig.json"));
    const outputDir = resolveOutputDir(rootUri, manifest.constructor, pcfConfig);

    return {
      rootUri,
      manifestUri: manifestPath,
      namespace: manifest.namespace,
      constructor: manifest.constructor,
      fullName: `${manifest.namespace}.${manifest.constructor}`,
      version: manifest.version,
      controlType: manifest.controlType,
      displayName: manifest.displayName,
      description: manifest.description,
      templateKind: detectTemplateKind(packageJson),
      outputDir,
      hasNodeModules: await exists(this.files, path.join(rootUri, "node_modules")),
      cdsProjectUri: await findNearestCdsProject(this.files, rootUri),
    };
  }

  private async findManifestPaths(): Promise<string[]> {
    const manifests: string[] = [];

    for (const folder of this.files.workspaceFolders) {
      const matches = await findManifests(this.files, folder);
      manifests.push(...matches);
    }

    return manifests;
  }

  private startWatching(): void {
    if (this.watcher || !this.watchManifests) {
      return;
    }

    const refresh = () => {
      void this.refresh();
    };
    this.watcher = this.watchManifests(refresh);
  }
}

async function findManifests(files: WorkspaceFilesPort, root: string): Promise<string[]> {
  const manifests: string[] = [];

  async function visit(dir: string): Promise<void> {
    const entries = await listDirectoryEntries(files, dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.type === WorkspaceFileType.Directory) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(fullPath);
        }
      } else if (entry.type === WorkspaceFileType.File && entry.name === MANIFEST_FILENAME) {
        manifests.push(fullPath);
      }
    }
  }

  await visit(root);
  return manifests.sort();
}

async function readJsonFile(
  files: Pick<WorkspaceFilesPort, "readFile">,
  filePath: string,
): Promise<unknown | undefined> {
  try {
    const content = Buffer.from(await files.readFile(filePath)).toString("utf8");
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

async function resolveProjectRoot(
  files: WorkspaceFilesPort,
  manifestRoot: string,
): Promise<string> {
  const pcfProjectRoot = await findNearestDirectoryWithFile(files, manifestRoot, (name) =>
    name.endsWith(".pcfproj"),
  );
  if (pcfProjectRoot) {
    return pcfProjectRoot;
  }

  return (
    (await findNearestDirectoryWithFile(files, manifestRoot, (name) => name === "package.json")) ??
    manifestRoot
  );
}

async function findNearestDirectoryWithFile(
  files: WorkspaceFilesPort,
  startDir: string,
  matches: (name: string) => boolean,
): Promise<string | undefined> {
  let current = startDir;

  while (true) {
    const entries = await listDirectoryEntries(files, current);
    if (entries.some((entry) => entry.type === WorkspaceFileType.File && matches(entry.name))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function findNearestCdsProject(
  files: WorkspaceFilesPort,
  projectRoot: string,
): Promise<string | undefined> {
  let current = projectRoot;
  while (true) {
    const cdsProjects = await listCdsProjects(files, current);
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

async function listCdsProjects(files: WorkspaceFilesPort, dir: string): Promise<string[]> {
  const entries = await listDirectoryEntries(files, dir);
  return entries
    .filter((entry) => entry.type === WorkspaceFileType.File && entry.name.endsWith(".cdsproj"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

async function listDirectoryEntries(
  files: Pick<WorkspaceFilesPort, "readDirectory">,
  dir: string,
): Promise<WorkspaceDirectoryEntry[]> {
  try {
    return await files.readDirectory(dir);
  } catch {
    return [];
  }
}

async function exists(
  files: Pick<WorkspaceFilesPort, "exists">,
  filePath: string,
): Promise<boolean> {
  return files.exists(filePath);
}

class SimpleEventEmitter<T> {
  private readonly listeners = new Set<EventListener<T>>();

  readonly event = (listener: EventListener<T>) => {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  };

  fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
