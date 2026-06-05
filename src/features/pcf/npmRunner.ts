import * as fs from "fs/promises";
import * as path from "path";
import type * as vscode from "vscode";
import { ProcessRunResult } from "./models";
import { ProcessRunner, RunningProcess } from "./processRunner";

export interface NpmPackageInfo {
  scripts: Record<string, string>;
}

export class NpmRunner {
  constructor(private readonly runner: ProcessRunner) {}

  async readPackageInfo(projectRoot: string): Promise<NpmPackageInfo> {
    const packageJsonPath = path.join(projectRoot, "package.json");
    const content = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(content) as unknown;

    return {
      scripts: readScripts(parsed),
    };
  }

  install(
    projectRoot: string,
    onLine?: (line: string, stream: "stdout" | "stderr") => void,
    token?: vscode.CancellationToken,
  ): Promise<ProcessRunResult> {
    return this.runner.run("npm", ["install"], { cwd: projectRoot, onLine, token });
  }

  runScript(
    projectRoot: string,
    script: string,
    scriptArgs: string[] = [],
    onLine?: (line: string, stream: "stdout" | "stderr") => void,
    token?: vscode.CancellationToken,
  ): Promise<ProcessRunResult> {
    return this.runner.run("npm", buildRunArgs(script, scriptArgs), {
      cwd: projectRoot,
      onLine,
      token,
    });
  }

  startDefault(
    projectRoot: string,
    args: string[] = [],
    onLine?: (line: string, stream: "stdout" | "stderr") => void,
    token?: vscode.CancellationToken,
  ): RunningProcess {
    return this.runner.start("npm", ["start", ...args], {
      cwd: projectRoot,
      onLine,
      token,
    });
  }
}

function buildRunArgs(script: string, scriptArgs: string[]): string[] {
  const args = ["run", script];
  if (scriptArgs.length) {
    args.push("--", ...scriptArgs);
  }
  return args;
}

function readScripts(value: unknown): Record<string, string> {
  if (!isRecord(value) || !isRecord(value.scripts)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value.scripts).filter((entry): entry is [string, string] => {
      return typeof entry[1] === "string";
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
