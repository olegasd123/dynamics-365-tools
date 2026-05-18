import type * as vscode from "vscode";
import {
  PacAuthCreateOptions,
  PacAuthProfile,
  PacRunResult,
  PcfInitOptions,
  PcfPushOptions,
  SolutionAddReferenceOptions,
  SolutionInitOptions,
  ToolDetectionResult,
} from "./models";
import { ProcessRunner } from "./processRunner";

export class PacCli {
  private detection?: Promise<ToolDetectionResult>;

  constructor(private readonly runner: ProcessRunner) {}

  detect(): Promise<ToolDetectionResult> {
    this.detection ??= detectTool(this.runner, "pac", ["--version"]);
    return this.detection;
  }

  async help(args: string[]): Promise<string> {
    const result = await this.run([...args, "--help"]);
    return result.stdout || result.stderr;
  }

  async whoami(): Promise<PacAuthProfile | null> {
    const result = await this.run(["auth", "who", "--json"]);
    if (result.exitCode !== 0) {
      return null;
    }

    return parseAuthProfile(result.parsed, result.stdout);
  }

  async authCreate(
    opts: PacAuthCreateOptions,
    onLine?: (line: string, stream: "stdout" | "stderr") => void,
    token?: vscode.CancellationToken,
  ): Promise<PacRunResult> {
    return this.run(
      ["auth", "create", "--url", opts.url, "--name", opts.name],
      undefined,
      onLine,
      token,
    );
  }

  async pcfInit(
    opts: PcfInitOptions,
    cwd: string,
    onLine?: (line: string, stream: "stdout" | "stderr") => void,
    token?: vscode.CancellationToken,
  ): Promise<PacRunResult> {
    const args = [
      "pcf",
      "init",
      "--namespace",
      opts.namespace,
      "--name",
      opts.name,
      "--template",
      opts.template,
      "--framework",
      opts.framework,
    ];

    if (opts.runNpmInstall) {
      args.push("--run-npm-install");
    }

    return this.run(args, cwd, onLine, token);
  }

  async pcfPush(
    opts: PcfPushOptions,
    cwd: string,
    onLine?: (line: string, stream: "stdout" | "stderr") => void,
    token?: vscode.CancellationToken,
  ): Promise<PacRunResult> {
    return this.run(
      [
        "pcf",
        "push",
        "--environment",
        opts.environmentUrl,
        "--publisher-prefix",
        opts.publisherPrefix,
      ],
      cwd,
      onLine,
      token,
    );
  }

  async solutionInit(
    opts: SolutionInitOptions,
    cwd: string,
    onLine?: (line: string, stream: "stdout" | "stderr") => void,
    token?: vscode.CancellationToken,
  ): Promise<PacRunResult> {
    return this.run(
      [
        "solution",
        "init",
        "--publisher-name",
        opts.publisherName,
        "--publisher-prefix",
        opts.publisherPrefix,
      ],
      cwd,
      onLine,
      token,
    );
  }

  async solutionAddReference(
    opts: SolutionAddReferenceOptions,
    cwd: string,
    onLine?: (line: string, stream: "stdout" | "stderr") => void,
    token?: vscode.CancellationToken,
  ): Promise<PacRunResult> {
    return this.run(["solution", "add-reference", "--path", opts.path], cwd, onLine, token);
  }

  async run(
    args: string[],
    cwd?: string,
    onLine?: (line: string, stream: "stdout" | "stderr") => void,
    token?: vscode.CancellationToken,
  ): Promise<PacRunResult> {
    const result = await this.runner.run("pac", args, { cwd, onLine, token });
    return {
      ...result,
      parsed: parseJsonPayload(result.stdout),
    };
  }
}

export async function detectTool(
  runner: ProcessRunner,
  command: string,
  args: string[],
): Promise<ToolDetectionResult> {
  try {
    const result = await runner.run(command, args);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (result.exitCode !== 0) {
      return {
        available: false,
        error: output || `${command} exited with code ${result.exitCode}`,
      };
    }

    return {
      available: true,
      version: firstMeaningfulLine(output),
      path: command,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function firstMeaningfulLine(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function parseJsonPayload(stdout: string): unknown | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function parseAuthProfile(parsed: unknown, stdout: string): PacAuthProfile | null {
  const fromJson = readAuthProfile(parsed);
  if (fromJson) {
    return fromJson;
  }

  const url = stdout.match(/https:\/\/[^\s"']+/i)?.[0];
  if (!url) {
    return null;
  }
  return { url };
}

function readAuthProfile(value: unknown): PacAuthProfile | null {
  if (Array.isArray(value)) {
    const selected =
      value.find((item) => isRecord(item) && (item.active === true || item.isActive === true)) ??
      value[0];
    return readAuthProfile(selected);
  }

  if (!isRecord(value)) {
    return null;
  }

  const source = isRecord(value.result) ? value.result : value;
  const url = readString(
    source.environmentUrl,
    source.environment,
    source.url,
    source.resource,
    source.dataverseUrl,
  );
  const name = readString(source.name, source.profileName);
  const user = readString(source.user, source.username, source.userName);

  return url || name || user ? { name, url, user } : null;
}

function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
