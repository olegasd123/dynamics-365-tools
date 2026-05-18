import assert from "node:assert";
import test from "node:test";
import { PacCli, detectTool } from "../pacCli";

test("detectTool returns version for available commands", async () => {
  const runner = {
    run: async () => ({
      exitCode: 0,
      stdout: "1.2.3\n",
      stderr: "",
      durationMs: 4,
    }),
  };

  const result = await detectTool(runner as any, "pac", ["--version"]);

  assert.deepStrictEqual(result, {
    available: true,
    version: "1.2.3",
    path: "pac",
  });
});

test("detectTool returns an unavailable result for spawn errors", async () => {
  const runner = {
    run: async () => {
      throw new Error("spawn pac ENOENT");
    },
  };

  const result = await detectTool(runner as any, "pac", ["--version"]);

  assert.strictEqual(result.available, false);
  assert.match(result.error ?? "", /ENOENT/);
});

test("PacCli parses JSON stdout when present", async () => {
  const calls: string[][] = [];
  const runner = {
    run: async (_command: string, args: string[]) => {
      calls.push(args);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ok: true }),
        stderr: "",
        durationMs: 10,
      };
    },
  };

  const pac = new PacCli(runner as any);
  const result = await pac.run(["some", "command", "--json"]);

  assert.deepStrictEqual(calls, [["some", "command", "--json"]]);
  assert.deepStrictEqual(result.parsed, { ok: true });
});

test("PacCli builds pcf init arguments", async () => {
  const calls: Array<{ args: string[]; cwd?: string }> = [];
  const runner = {
    run: async (_command: string, args: string[], options: { cwd?: string }) => {
      calls.push({ args, cwd: options.cwd });
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
      };
    },
  };

  const pac = new PacCli(runner as any);
  await pac.pcfInit(
    {
      namespace: "Contoso.Controls",
      name: "LinearInput",
      template: "field",
      framework: "react",
      runNpmInstall: true,
    },
    "/tmp/control",
  );

  assert.deepStrictEqual(calls, [
    {
      args: [
        "pcf",
        "init",
        "--namespace",
        "Contoso.Controls",
        "--name",
        "LinearInput",
        "--template",
        "field",
        "--framework",
        "react",
        "--run-npm-install",
      ],
      cwd: "/tmp/control",
    },
  ]);
});
