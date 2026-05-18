import type * as vscode from "vscode";
import { PacRunResult, PcfInitOptions, ToolDetectionResult } from "./models";
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
