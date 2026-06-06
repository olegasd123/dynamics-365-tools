import * as path from "path";
import { XMLParser } from "fast-xml-parser";
import { WorkspaceFileType, type WorkspaceFilesPort } from "@app/ports/files";
import { NoopTextInput, TextInputPort } from "@app/ports/input";
import { NoopNotificationService, NotificationPort } from "@app/ports/notifications";
import { NoopOutputPort, OutputChannelPort, OutputPort } from "@app/ports/output";
import type { CancellationTokenLike } from "@app/ports/progress";
import { NoopWorkbench, WorkbenchPort } from "@app/ports/workbench";
import { ConfigurationService } from "../config/configurationService";
import { CdsSolutionProject, PcfControlProject, PcfPackageResult } from "./models";
import { PacCli } from "./pacCli";
import { PcfWorkspaceSettingsService } from "./pcfWorkspaceSettings";
import { ProcessRunner } from "./processRunner";
import { validatePublisherPrefix } from "./pcfPushService";
import { PcfTelemetryService } from "./pcfTelemetry";

export interface PcfPackageOptions {
  managed: boolean;
  token?: CancellationTokenLike;
}

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "out", "bin", "obj"]);

export class PcfPackageService {
  private readonly output: OutputChannelPort;

  constructor(
    private readonly pacCli: PacCli,
    private readonly runner: ProcessRunner,
    private readonly settings: PcfWorkspaceSettingsService,
    private readonly configuration: ConfigurationService,
    private readonly files: WorkspaceFilesPort,
    private readonly notifications: NotificationPort = new NoopNotificationService(),
    private readonly telemetry?: PcfTelemetryService,
    output: OutputPort = new NoopOutputPort(),
    private readonly input: TextInputPort = new NoopTextInput(),
    private readonly workbench: WorkbenchPort = new NoopWorkbench(),
  ) {
    this.output = output.createChannel("PCF Package");
  }

  async packageControl(
    project: PcfControlProject,
    options: PcfPackageOptions,
  ): Promise<PcfPackageResult | undefined> {
    const pcfProjectPath = await findPcfProjectPath(this.files, project.rootUri);
    if (!pcfProjectPath) {
      await this.notifications.error(`No .pcfproj file was found for ${project.fullName}.`);
      return undefined;
    }

    const solution = await this.resolveSolutionWrapper(project, pcfProjectPath, options.token);
    if (!solution) {
      return undefined;
    }

    const buildConfiguration = options.managed ? "Release" : "Debug";
    this.output.show(true);
    this.output.appendLine("");
    this.output.appendLine(
      `[${new Date().toISOString()}] Package ${project.fullName} as ${options.managed ? "managed" : "unmanaged"}`,
    );
    this.output.appendLine(`Solution project: ${solution.cdsProjectUri}`);
    this.output.appendLine(`Configuration: ${buildConfiguration}`);

    const result = await this.runner.run(
      "dotnet",
      [
        "build",
        solution.cdsProjectUri,
        `/p:configuration=${buildConfiguration}`,
        `/p:managed=${options.managed ? "true" : "false"}`,
      ],
      {
        cwd: solution.rootUri,
        token: options.token,
        onLine: (line, stream) =>
          this.output.appendLine(stream === "stderr" ? `[stderr] ${line}` : line),
      },
    );

    if (result.exitCode !== 0) {
      this.telemetry?.package(project, false, options.managed, result.durationMs);
      await this.notifications.error(
        `PCF solution package failed for ${project.fullName} with exit code ${result.exitCode}.`,
      );
      return undefined;
    }

    const zipPath =
      parseSolutionZipPath(`${result.stdout}\n${result.stderr}`, solution.rootUri) ??
      (await findNewestSolutionZip(this.files, solution.rootUri, buildConfiguration));
    if (!zipPath) {
      await this.notifications.error(
        `PCF solution package built, but no solution .zip path could be found for ${project.fullName}.`,
      );
      return undefined;
    }

    const storedZipPath = this.toWorkspacePath(zipPath);
    await this.settings.updateProjectSettings(project, {
      lastPackagedZip: storedZipPath,
      publisherPrefix: solution.publisherPrefix,
    });
    this.telemetry?.package(project, true, options.managed, result.durationMs);
    this.output.appendLine(`Packaged solution: ${zipPath}`);
    await this.notifications.info(
      `PCF solution package created for ${project.fullName}: ${storedZipPath}`,
    );

    return {
      cdsProjectUri: solution.cdsProjectUri,
      zipPath,
      managed: options.managed,
      configuration: buildConfiguration,
      durationMs: result.durationMs,
    };
  }

  dispose(): void {
    this.output.dispose();
  }

  private async resolveSolutionWrapper(
    project: PcfControlProject,
    pcfProjectPath: string,
    token?: CancellationTokenLike,
  ): Promise<CdsSolutionProject | undefined> {
    const existing = await this.findExistingSolution(project, pcfProjectPath);
    if (existing) {
      return this.ensureSolutionReferencesPcf(existing, pcfProjectPath, token);
    }

    const workspaceRoot = this.configuration.workspaceRoot ?? path.dirname(project.rootUri);
    const defaultSolutionRoot = path.join(workspaceRoot, "solution");
    const defaultSolution = await findFirstCdsProject(this.files, defaultSolutionRoot);
    if (defaultSolution) {
      return this.ensureSolutionReferencesPcf(
        await readCdsSolutionProject(this.files, defaultSolution),
        pcfProjectPath,
        token,
      );
    }

    const action = await this.notifications.askWarning(
      `No .cdsproj solution wrapper references ${project.fullName}. Create one at ${defaultSolutionRoot}?`,
      ["Create", "Cancel"],
    );
    if (action !== "Create") {
      return undefined;
    }

    return this.createSolutionWrapper(project, pcfProjectPath, defaultSolutionRoot, token);
  }

  private async findExistingSolution(
    project: PcfControlProject,
    pcfProjectPath: string,
  ): Promise<CdsSolutionProject | undefined> {
    if (project.cdsProjectUri) {
      return readCdsSolutionProject(this.files, project.cdsProjectUri);
    }

    const workspaceRoot = this.configuration.workspaceRoot ?? path.dirname(project.rootUri);
    const cdsProjects = await findCdsProjects(this.files, workspaceRoot);
    for (const cdsProjectUri of cdsProjects) {
      const solution = await readCdsSolutionProject(this.files, cdsProjectUri);
      if (referencesPcfProject(solution, pcfProjectPath)) {
        return solution;
      }
    }

    return undefined;
  }

  private async ensureSolutionReferencesPcf(
    solution: CdsSolutionProject,
    pcfProjectPath: string,
    token?: CancellationTokenLike,
  ): Promise<CdsSolutionProject | undefined> {
    if (referencesPcfProject(solution, pcfProjectPath)) {
      return solution;
    }

    if (!(await this.ensurePacAvailable())) {
      return undefined;
    }

    this.output.show(true);
    this.output.appendLine(`Adding PCF project reference to ${solution.cdsProjectUri}`);
    const result = await this.pacCli.solutionAddReference(
      { path: pcfProjectPath },
      solution.rootUri,
      (line, stream) => this.output.appendLine(stream === "stderr" ? `[stderr] ${line}` : line),
      token,
    );
    if (result.exitCode !== 0) {
      await this.notifications.error(
        `Failed to add PCF project reference to ${path.basename(solution.cdsProjectUri)}.`,
      );
      return undefined;
    }

    return readCdsSolutionProject(this.files, solution.cdsProjectUri);
  }

  private async createSolutionWrapper(
    project: PcfControlProject,
    pcfProjectPath: string,
    solutionRoot: string,
    token?: CancellationTokenLike,
  ): Promise<CdsSolutionProject | undefined> {
    if (!(await this.ensurePacAvailable())) {
      return undefined;
    }

    const publisherPrefix = await this.resolvePublisherPrefix(project);
    if (!publisherPrefix) {
      return undefined;
    }

    const publisherName = await this.input.showInputBox({
      prompt: "Publisher name for the generated PCF solution wrapper",
      placeHolder: "Contoso",
      value: `${publisherPrefix} Publisher`,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : "Publisher name is required."),
    });
    if (!publisherName) {
      return undefined;
    }

    await this.files.createDirectory(solutionRoot);
    this.output.show(true);
    this.output.appendLine(`Creating PCF solution wrapper at ${solutionRoot}`);
    const initResult = await this.pacCli.solutionInit(
      { publisherName: publisherName.trim(), publisherPrefix },
      solutionRoot,
      (line, stream) => this.output.appendLine(stream === "stderr" ? `[stderr] ${line}` : line),
      token,
    );
    if (initResult.exitCode !== 0) {
      await this.notifications.error("Failed to create the PCF solution wrapper.");
      return undefined;
    }

    const cdsProjectUri = await findFirstCdsProject(this.files, solutionRoot);
    if (!cdsProjectUri) {
      await this.notifications.error("pac solution init completed, but no .cdsproj was found.");
      return undefined;
    }

    const solution = await readCdsSolutionProject(this.files, cdsProjectUri);
    const referenced = await this.ensureSolutionReferencesPcf(solution, pcfProjectPath, token);
    if (!referenced) {
      return undefined;
    }

    return {
      ...referenced,
      publisherPrefix: referenced.publisherPrefix ?? publisherPrefix,
    };
  }

  private async resolvePublisherPrefix(project: PcfControlProject): Promise<string | undefined> {
    const stored = (await this.settings.getProjectSettings(project)).publisherPrefix;
    const entered = await this.input.showInputBox({
      prompt: `Publisher prefix for the generated solution wrapper for ${project.fullName}`,
      placeHolder: "new",
      value: stored,
      ignoreFocusOut: true,
      validateInput: validatePublisherPrefix,
    });
    if (!entered) {
      return undefined;
    }

    const prefix = entered.trim();
    await this.settings.updateProjectSettings(project, { publisherPrefix: prefix });
    return prefix;
  }

  private async ensurePacAvailable(): Promise<boolean> {
    const result = await this.pacCli.detect();
    if (result.available) {
      return true;
    }

    const action = await this.notifications.askError(
      `Power Platform CLI is required to create or update PCF solution wrappers: ${result.error ?? "pac not found"}.`,
      ["Install pac CLI"],
    );
    if (action === "Install pac CLI") {
      await this.workbench.openExternal(
        "https://learn.microsoft.com/power-platform/developer/cli/introduction",
      );
    }
    return false;
  }

  private toWorkspacePath(filePath: string): string {
    const relative = this.configuration.getRelativeToWorkspace(filePath);
    return normalizeSlashes(relative || filePath);
  }
}

export function parseSolutionZipPath(output: string, cwd: string): string | undefined {
  const candidates: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const matches = line.match(/(?:[A-Za-z]:\\|\/|\.\.\/|\.\/)?[^\s"'<>]*\.zip/gi) ?? [];
    candidates.push(...matches);
  }

  const candidate = candidates
    .map((value) => value.trim().replace(/[),.;:]+$/, ""))
    .reverse()
    .find(Boolean);
  if (!candidate) {
    return undefined;
  }

  return path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(cwd, candidate);
}

async function findPcfProjectPath(
  files: WorkspaceFilesPort,
  projectRoot: string,
): Promise<string | undefined> {
  try {
    const entries = await files.readDirectory(projectRoot);
    const pcfProjects = entries
      .filter((entry) => entry.type === WorkspaceFileType.File && entry.name.endsWith(".pcfproj"))
      .map((entry) => path.join(projectRoot, entry.name))
      .sort();
    return pcfProjects[0];
  } catch {
    return undefined;
  }
}

async function findFirstCdsProject(
  files: WorkspaceFilesPort,
  root: string,
): Promise<string | undefined> {
  const projects = await findCdsProjects(files, root);
  return projects[0];
}

async function findCdsProjects(files: WorkspaceFilesPort, root: string): Promise<string[]> {
  const projects: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: Awaited<ReturnType<WorkspaceFilesPort["readDirectory"]>>;
    try {
      entries = await files.readDirectory(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.type === WorkspaceFileType.Directory) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(fullPath);
        }
      } else if (entry.type === WorkspaceFileType.File && entry.name.endsWith(".cdsproj")) {
        projects.push(fullPath);
      }
    }
  }

  await visit(root);
  return projects.sort();
}

async function readCdsSolutionProject(
  files: WorkspaceFilesPort,
  cdsProjectUri: string,
): Promise<CdsSolutionProject> {
  const rootUri = path.dirname(cdsProjectUri);
  const content = await readUtf8(files, cdsProjectUri).catch(() => "");
  const referencedPcfProjects = [
    ...content.matchAll(/<ProjectReference\b[^>]*\bInclude=["']([^"']+\.pcfproj)["']/gi),
  ].map((match) => path.resolve(rootUri, match[1]));

  return {
    rootUri,
    cdsProjectUri,
    referencedPcfProjects,
    publisherPrefix: await readPublisherPrefixFromSolution(files, rootUri),
    solutionUniqueName: path.basename(cdsProjectUri, ".cdsproj"),
  };
}

function referencesPcfProject(solution: CdsSolutionProject, pcfProjectPath: string): boolean {
  const normalizedPcfProjectPath = normalizeComparablePath(pcfProjectPath);
  return solution.referencedPcfProjects.some(
    (referenced) => normalizeComparablePath(referenced) === normalizedPcfProjectPath,
  );
}

async function readPublisherPrefixFromSolution(
  files: WorkspaceFilesPort,
  root: string,
): Promise<string | undefined> {
  const candidates = [
    path.join(root, "src", "Other", "Solution.xml"),
    path.join(root, "Other", "Solution.xml"),
    path.join(root, "Solution.xml"),
  ];

  for (const candidate of candidates) {
    const prefix = await readPublisherPrefix(files, candidate);
    if (prefix) {
      return prefix;
    }
  }
  return undefined;
}

async function readPublisherPrefix(
  files: WorkspaceFilesPort,
  filePath: string,
): Promise<string | undefined> {
  try {
    const content = await readUtf8(files, filePath);
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(content) as unknown;
    const found = findKey(parsed, "CustomizationPrefix");
    return typeof found === "string" && found.trim() ? found.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function findNewestSolutionZip(
  files: WorkspaceFilesPort,
  solutionRoot: string,
  configuration: "Debug" | "Release",
): Promise<string | undefined> {
  const roots = [path.join(solutionRoot, "bin", configuration), path.join(solutionRoot, "bin")];
  const zips: Array<{ filePath: string; mtimeMs: number }> = [];

  async function visit(dir: string): Promise<void> {
    let entries: Awaited<ReturnType<WorkspaceFilesPort["readDirectory"]>>;
    try {
      entries = await files.readDirectory(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.type === WorkspaceFileType.Directory) {
        await visit(fullPath);
      } else if (entry.type === WorkspaceFileType.File && entry.name.endsWith(".zip")) {
        const stat = await files.stat(fullPath);
        zips.push({ filePath: fullPath, mtimeMs: stat.mtime });
      }
    }
  }

  for (const root of roots) {
    await visit(root);
  }

  return zips.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath;
}

async function readUtf8(files: WorkspaceFilesPort, filePath: string): Promise<string> {
  return Buffer.from(await files.readFile(filePath)).toString("utf8");
}

function findKey(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, key);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (value[key] !== undefined) {
    return value[key];
  }

  for (const child of Object.values(value)) {
    const found = findKey(child, key);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function normalizeComparablePath(value: string): string {
  return path.resolve(value).toLowerCase();
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
