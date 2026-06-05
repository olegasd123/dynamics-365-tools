import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { NoopNotificationService, NotificationPort } from "../../app/ports/notifications";
import { PcfBuildStatus, PcfControlProject } from "./models";
import { NpmRunner } from "./npmRunner";
import { PcfStatusBarService } from "./pcfStatusBar";
import { PcfTelemetryService } from "./pcfTelemetry";
import { RunningProcess } from "./processRunner";

export interface PcfBuildOptions {
  production?: boolean;
  token?: vscode.CancellationToken;
}

interface WatchEntry {
  project: PcfControlProject;
  process: RunningProcess;
}

export class PcfBuildService implements vscode.Disposable {
  private readonly statuses = new Map<string, PcfBuildStatus>();
  private readonly outputChannels = new Map<string, vscode.OutputChannel>();
  private readonly watches = new Map<string, WatchEntry>();
  private readonly diagnosticFilesByProject = new Map<string, string[]>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("d365-pcf");
  private readonly onDidChangeStatusEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeStatus = this.onDidChangeStatusEmitter.event;

  constructor(
    private readonly npmRunner: NpmRunner,
    private readonly statusBar: PcfStatusBarService,
    private readonly notifications: NotificationPort = new NoopNotificationService(),
    private readonly telemetry?: PcfTelemetryService,
  ) {}

  getBuildStatus(project: PcfControlProject): PcfBuildStatus {
    return this.statuses.get(project.rootUri) ?? { kind: "never" };
  }

  isWatching(project: PcfControlProject): boolean {
    return this.watches.has(project.rootUri);
  }

  async build(project: PcfControlProject, options: PcfBuildOptions = {}): Promise<boolean> {
    const output = this.getOutput(project);
    output.show(true);
    output.appendLine("");
    output.appendLine(`[${new Date().toISOString()}] Build ${project.fullName}`);

    if (!(await this.ensureNodeModules(project, output, options.token))) {
      return false;
    }

    const packageInfo = await this.readPackageInfo(project);
    if (!packageInfo.scripts.build) {
      await this.notifications.error(`PCF project ${project.fullName} has no build script.`);
      return false;
    }

    this.setStatus(project, { kind: "running" });
    this.clearProjectDiagnostics(project);

    const startedAt = Date.now();
    const result = await this.npmRunner.runScript(
      project.rootUri,
      "build",
      options.production ? ["--buildMode", "production"] : [],
      (line, stream) => {
        output.appendLine(stream === "stderr" ? `[stderr] ${line}` : line);
      },
      options.token,
    );

    this.updateDiagnostics(project, `${result.stdout}\n${result.stderr}`);
    const status: PcfBuildStatus =
      result.exitCode === 0
        ? { kind: "success", finishedAt: Date.now(), durationMs: result.durationMs, exitCode: 0 }
        : {
            kind: "failed",
            finishedAt: Date.now(),
            durationMs: result.durationMs,
            exitCode: result.exitCode,
          };

    this.setStatus(project, status);
    this.telemetry?.build(project, result.exitCode === 0, result.durationMs);
    output.appendLine(
      result.exitCode === 0
        ? `Build finished in ${Date.now() - startedAt}ms.`
        : `Build failed with exit code ${result.exitCode}.`,
    );
    return result.exitCode === 0;
  }

  async startWatch(project: PcfControlProject): Promise<boolean> {
    if (this.watches.has(project.rootUri)) {
      await this.notifications.info(`PCF watch is already running for ${project.fullName}.`);
      return true;
    }

    const packageInfo = await this.readPackageInfo(project);
    if (!isPcfStartScript(packageInfo.scripts.start)) {
      await this.notifications.error(
        `PCF project ${project.fullName} needs a start script like "pcf-scripts start".`,
      );
      return false;
    }

    const output = this.getOutput(project);
    output.show(true);
    output.appendLine("");
    output.appendLine(`[${new Date().toISOString()}] Watch ${project.fullName}`);

    const running = this.npmRunner.startDefault(project.rootUri, ["watch"], (line, stream) => {
      output.appendLine(stream === "stderr" ? `[stderr] ${line}` : line);
    });

    this.watches.set(project.rootUri, { project, process: running });
    this.statusBar.setWatching({ project });
    this.onDidChangeStatusEmitter.fire();

    void running.exited.then(
      (result) => {
        this.watches.delete(project.rootUri);
        this.statusBar.clear(project);
        this.onDidChangeStatusEmitter.fire();
        output.appendLine(`Watch stopped with exit code ${result.exitCode}.`);
      },
      (error) => {
        this.watches.delete(project.rootUri);
        this.statusBar.clear(project);
        this.onDidChangeStatusEmitter.fire();
        output.appendLine(`Watch failed: ${String(error)}`);
      },
    );

    return true;
  }

  stopWatch(project?: PcfControlProject): void {
    const entries = project
      ? [...this.watches.values()].filter((entry) => entry.project.rootUri === project.rootUri)
      : [...this.watches.values()];

    for (const entry of entries) {
      entry.process.kill();
      this.watches.delete(entry.project.rootUri);
      this.statusBar.clear(entry.project);
    }

    this.onDidChangeStatusEmitter.fire();
  }

  dispose(): void {
    this.stopWatch();
    this.diagnostics.dispose();
    this.onDidChangeStatusEmitter.dispose();
    for (const output of this.outputChannels.values()) {
      output.dispose();
    }
    this.outputChannels.clear();
  }

  private async ensureNodeModules(
    project: PcfControlProject,
    output: vscode.OutputChannel,
    token?: vscode.CancellationToken,
  ): Promise<boolean> {
    if (await exists(path.join(project.rootUri, "node_modules"))) {
      return true;
    }

    const choice = await this.notifications.askWarning(
      `Dependencies are missing for ${project.fullName}. Run npm install now?`,
      ["Install", "Skip"],
    );
    if (choice !== "Install") {
      output.appendLine("Build cancelled because dependencies are missing.");
      return false;
    }

    output.appendLine("Running npm install...");
    const result = await this.npmRunner.install(
      project.rootUri,
      (line, stream) => output.appendLine(stream === "stderr" ? `[stderr] ${line}` : line),
      token,
    );

    if (result.exitCode !== 0) {
      output.appendLine(`npm install failed with exit code ${result.exitCode}.`);
      await this.notifications.error(`npm install failed for ${project.fullName}.`);
      return false;
    }

    return true;
  }

  private async readPackageInfo(project: PcfControlProject) {
    try {
      return await this.npmRunner.readPackageInfo(project.rootUri);
    } catch (error) {
      throw new Error(`Failed to read package.json for ${project.fullName}: ${String(error)}`);
    }
  }

  private getOutput(project: PcfControlProject): vscode.OutputChannel {
    const existing = this.outputChannels.get(project.rootUri);
    if (existing) {
      return existing;
    }

    const created = vscode.window.createOutputChannel(`PCF: ${project.fullName}`);
    this.outputChannels.set(project.rootUri, created);
    return created;
  }

  private setStatus(project: PcfControlProject, status: PcfBuildStatus): void {
    this.statuses.set(project.rootUri, status);
    this.onDidChangeStatusEmitter.fire();
  }

  private updateDiagnostics(project: PcfControlProject, output: string): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const line of output.split(/\r?\n/)) {
      const parsed = parseTypeScriptDiagnostic(project.rootUri, line);
      if (!parsed) {
        continue;
      }

      const diagnostics = byFile.get(parsed.filePath) ?? [];
      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(
            new vscode.Position(parsed.line - 1, parsed.character - 1),
            new vscode.Position(parsed.line - 1, parsed.character),
          ),
          `${parsed.code}: ${parsed.message}`,
          vscode.DiagnosticSeverity.Error,
        ),
      );
      byFile.set(parsed.filePath, diagnostics);
    }

    this.clearProjectDiagnostics(project);
    this.diagnosticFilesByProject.set(project.rootUri, [...byFile.keys()]);
    for (const [filePath, diagnostics] of byFile.entries()) {
      this.diagnostics.set(vscode.Uri.file(filePath), diagnostics);
    }
  }

  private clearProjectDiagnostics(project: PcfControlProject): void {
    for (const filePath of this.diagnosticFilesByProject.get(project.rootUri) ?? []) {
      this.diagnostics.delete(vscode.Uri.file(filePath));
    }
    this.diagnosticFilesByProject.delete(project.rootUri);
  }
}

function isPcfStartScript(script: string | undefined): boolean {
  return !!script && /\bpcf-scripts\b/.test(script) && /\bstart\b/.test(script);
}

function parseTypeScriptDiagnostic(projectRoot: string, line: string) {
  const match = /^(.+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/.exec(line.trim());
  if (!match) {
    return undefined;
  }

  return {
    filePath: path.resolve(projectRoot, match[1]),
    line: Number(match[2]),
    character: Number(match[3]),
    code: match[4],
    message: match[5],
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
