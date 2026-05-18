import assert from "node:assert";
import test from "node:test";
import { NpmRunner } from "../npmRunner";

test("NpmRunner builds npm script commands with extra args", async () => {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const runner = {
    run: async (command: string, args: string[], options: { cwd?: string }) => {
      calls.push({ command, args, cwd: options.cwd });
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
      };
    },
  };

  const npm = new NpmRunner(runner as any);
  await npm.runScript("/tmp/project", "build", ["--buildMode", "production"]);

  assert.deepStrictEqual(calls, [
    {
      command: "npm",
      args: ["run", "build", "--", "--buildMode", "production"],
      cwd: "/tmp/project",
    },
  ]);
});

test("NpmRunner starts the PCF watch command", () => {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const runner = {
    start: (command: string, args: string[], options: { cwd?: string }) => {
      calls.push({ command, args, cwd: options.cwd });
      return {
        command,
        args,
        cwd: options.cwd,
        exited: new Promise(() => undefined),
        kill: () => undefined,
      };
    },
  };

  const npm = new NpmRunner(runner as any);
  npm.startDefault("/tmp/project", ["watch"]);

  assert.deepStrictEqual(calls, [
    {
      command: "npm",
      args: ["start", "watch"],
      cwd: "/tmp/project",
    },
  ]);
});
