import { spawn } from "child_process";
import type { CancellationTokenLike } from "@app/ports/progress";
import { ProcessRunResult } from "./models";

export interface ProcessRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  token?: CancellationTokenLike;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
}

export interface RunningProcess {
  readonly command: string;
  readonly args: string[];
  readonly cwd?: string;
  readonly exited: Promise<ProcessRunResult>;
  kill(): void;
}

export class ProcessRunner {
  private readonly running = new Set<ReturnType<typeof spawn>>();

  async run(
    command: string,
    args: string[] = [],
    options: ProcessRunOptions = {},
  ): Promise<ProcessRunResult> {
    return this.start(command, args, options).exited;
  }

  start(command: string, args: string[] = [], options: ProcessRunOptions = {}): RunningProcess {
    const startedAt = Date.now();

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
    });

    this.running.add(child);
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    const exited = new Promise<ProcessRunResult>((resolve, reject) => {
      const finish = (exitCode: number): void => {
        if (settled) {
          return;
        }
        settled = true;
        flushLine(stdoutBuffer, "stdout", options.onLine);
        flushLine(stderrBuffer, "stderr", options.onLine);
        this.running.delete(child);
        resolve({
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        });
      };

      const cancellation = options.token?.onCancellationRequested?.(() => {
        if (!child.killed) {
          child.kill();
        }
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        stdoutBuffer = emitCompleteLines(stdoutBuffer + text, "stdout", options.onLine);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        stderrBuffer = emitCompleteLines(stderrBuffer + text, "stderr", options.onLine);
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cancellation?.dispose();
        this.running.delete(child);
        reject(error);
      });

      child.on("close", (code) => {
        cancellation?.dispose();
        finish(code ?? 1);
      });
    });

    return {
      command,
      args,
      cwd: options.cwd,
      exited,
      kill: () => {
        if (!child.killed) {
          child.kill();
        }
      },
    };
  }

  dispose(): void {
    for (const child of this.running) {
      if (!child.killed) {
        child.kill();
      }
    }
    this.running.clear();
  }
}

function emitCompleteLines(
  buffer: string,
  stream: "stdout" | "stderr",
  onLine?: (line: string, stream: "stdout" | "stderr") => void,
): string {
  const lines = buffer.split(/\r?\n/);
  const tail = lines.pop() ?? "";
  for (const line of lines) {
    onLine?.(line, stream);
  }
  return tail;
}

function flushLine(
  line: string,
  stream: "stdout" | "stderr",
  onLine?: (line: string, stream: "stdout" | "stderr") => void,
): void {
  if (line.length) {
    onLine?.(line, stream);
  }
}
