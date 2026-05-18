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

test("PacCli builds pcf push arguments with explicit environment", async () => {
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
  await pac.pcfPush(
    {
      environmentUrl: "https://dev.crm.dynamics.com",
      publisherPrefix: "contoso",
    },
    "/tmp/control",
  );

  assert.deepStrictEqual(calls, [
    {
      args: [
        "pcf",
        "push",
        "--environment",
        "https://dev.crm.dynamics.com",
        "--publisher-prefix",
        "contoso",
      ],
      cwd: "/tmp/control",
    },
  ]);
});

test("PacCli parses active auth profile JSON", async () => {
  const runner = {
    run: async () => ({
      exitCode: 0,
      stdout: JSON.stringify([
        { name: "old", url: "https://old.crm.dynamics.com" },
        { name: "dev", url: "https://dev.crm.dynamics.com", active: true },
      ]),
      stderr: "",
      durationMs: 10,
    }),
  };

  const pac = new PacCli(runner as any);
  const profile = await pac.whoami();

  assert.deepStrictEqual(profile, {
    name: "dev",
    url: "https://dev.crm.dynamics.com",
    user: undefined,
  });
});

test("PacCli builds solution init arguments", async () => {
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
  await pac.solutionInit(
    {
      publisherName: "Contoso Publisher",
      publisherPrefix: "contoso",
    },
    "/tmp/solution",
  );

  assert.deepStrictEqual(calls, [
    {
      args: [
        "solution",
        "init",
        "--publisher-name",
        "Contoso Publisher",
        "--publisher-prefix",
        "contoso",
      ],
      cwd: "/tmp/solution",
    },
  ]);
});

test("PacCli builds solution add-reference arguments", async () => {
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
  await pac.solutionAddReference({ path: "/tmp/control/Control.pcfproj" }, "/tmp/solution");

  assert.deepStrictEqual(calls, [
    {
      args: ["solution", "add-reference", "--path", "/tmp/control/Control.pcfproj"],
      cwd: "/tmp/solution",
    },
  ]);
});
