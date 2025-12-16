import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { PublisherService } from "../services/publisherService";

test("resolvePaths maps folder bindings to nested files", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-publish-"));
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];
  const folder = path.join(workspaceRoot, "web");
  const file = path.join(folder, "script.js");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(file, "console.log('hi');");

  const publisher = new PublisherService();
  const paths = await (publisher as any).resolvePaths(
    {
      relativeLocalPath: folder,
      remotePath: "new_/web",
      solutionName: "CoreWebResources",
      kind: "folder",
    },
    vscode.Uri.file(file),
  );

  assert.strictEqual(paths.localPath, file);
  assert.strictEqual(paths.remotePath, "new_/web/script.js");
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("resolvePaths rejects publishing a directory target", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-publish-"));
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];
  const folder = path.join(workspaceRoot, "web");
  await fs.mkdir(folder, { recursive: true });

  const publisher = new PublisherService();
  await assert.rejects(
    (publisher as any).resolvePaths(
      {
        relativeLocalPath: folder,
        remotePath: "new_/web",
        solutionName: "CoreWebResources",
        kind: "folder",
      },
      vscode.Uri.file(folder),
    ),
    /Select a file inside the bound folder to publish/,
  );

  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("detectType maps known extensions to correct codes", () => {
  const publisher = new PublisherService();
  assert.strictEqual((publisher as any).detectType("file.css"), 2);
  assert.strictEqual((publisher as any).detectType("file.js"), 3);
  assert.strictEqual((publisher as any).detectType("file.xml"), 4);
  assert.strictEqual((publisher as any).detectType("file.png"), 5);
  assert.strictEqual((publisher as any).detectType("file.svg"), 12);
});

test("resolveToken uses interactive token when provided", async () => {
  const publisher = new PublisherService();
  const token = await (publisher as any).resolveToken(
    { name: "dev", url: "https://example" },
    { accessToken: "interactive-token" },
    true,
  );

  assert.strictEqual(token, "interactive-token");
  const logs = (publisher as any).output.logs;
  assert.ok(logs.some((line: string) => line.includes("auth: interactive token")));
});

test("resolveToken falls back to client credentials when interactive token missing", async () => {
  const publisher = new PublisherService();
  (publisher as any).acquireTokenWithClientCredentials = async () => "client-token";

  const token = await (publisher as any).resolveToken(
    { name: "dev", url: "https://example" },
    {
      credentials: {
        clientId: "id",
        clientSecret: "secret",
      },
    },
    true,
  );

  assert.strictEqual(token, "client-token");
  const logs = (publisher as any).output.logs;
  assert.ok(logs.some((line: string) => line.includes("auth: client credentials")));
});

test("resolveToken reuses provided client credential token without re-acquiring", async () => {
  const publisher = new PublisherService();
  (publisher as any).acquireTokenWithClientCredentials = async () => {
    throw new Error("should not request a new token");
  };

  const token = await (publisher as any).resolveToken(
    { name: "dev", url: "https://example" },
    {
      accessToken: "cached-token",
      credentials: {
        clientId: "id",
        clientSecret: "secret",
      },
    },
    true,
  );

  assert.strictEqual(token, "cached-token");
  const logs = (publisher as any).output.logs;
  assert.ok(logs.some((line: string) => line.includes("auth: client credentials")));
});

test("buildUserAgent returns default format when enabled", () => {
  const publisher = new PublisherService();
  (vscode.extensions as any).getExtension = () => ({
    packageJSON: { version: "1.2.3" },
  });

  const userAgent = (publisher as any).buildUserAgent({
    name: "dev",
    url: "https://example",
    userAgentEnabled: true,
  });

  assert.strictEqual(userAgent, "Dynamics365Tools-VSCode/1.2.3");
});

test("buildUserAgent returns custom value when provided", () => {
  const publisher = new PublisherService();
  const userAgent = (publisher as any).buildUserAgent({
    name: "dev",
    url: "https://example",
    userAgentEnabled: true,
    userAgent: "Custom-UA",
  });

  assert.strictEqual(userAgent, "Custom-UA");
});

test("acquireTokenWithClientCredentials sends user agent when provided", async () => {
  const publisher = new PublisherService();
  let capturedUserAgent: string | undefined;
  const originalFetch = global.fetch;
  global.fetch = (async (_url: any, init: any) => {
    capturedUserAgent = init.headers["User-Agent"];
    return new Response(JSON.stringify({ access_token: "token" }), {
      status: 200,
    });
  }) as any;

  try {
    const token = await (publisher as any).acquireTokenWithClientCredentials(
      { name: "dev", url: "https://example" },
      { clientId: "id", clientSecret: "secret" },
      "Agent/1.0",
    );
    assert.strictEqual(token, "token");
    assert.strictEqual(capturedUserAgent, "Agent/1.0");
  } finally {
    global.fetch = originalFetch;
  }
});

test("publish fails fast when solution is missing", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-publish-"));
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];
  const file = path.join(workspaceRoot, "script.js");
  await fs.writeFile(file, "console.log('hi');");

  const calls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: any) => {
    calls.push(String(url));
    if (String(url).includes("/solutions?")) {
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }
    if (String(url).includes("/webresourceset")) {
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }) as any;

  try {
    const publisher = new PublisherService();
    const result = await publisher.publish(
      {
        relativeLocalPath: file,
        remotePath: "new_/web/script.js",
        solutionName: "MissingSolution",
        kind: "file",
      },
      { name: "dev", url: "https://example" },
      { accessToken: "token" },
      vscode.Uri.file(file),
    );

    assert.strictEqual(result.failed, 1);
    assert.strictEqual(calls.length, 2);
    const logs = (publisher as any).output.logs.join("\n");
    assert.match(logs, /Solution MissingSolution not found/);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("publish aborts when remotePath matches multiple resources", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-publish-"));
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];
  const file = path.join(workspaceRoot, "script.js");
  await fs.writeFile(file, "console.log('hi');");

  const calls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: any) => {
    calls.push(String(url));
    if (String(url).includes("/solutions?")) {
      return new Response(JSON.stringify({ value: [{ solutionid: "abc" }] }), { status: 200 });
    }
    if (String(url).includes("/webresourceset")) {
      return new Response(
        JSON.stringify({
          value: [{ webresourceid: "one" }, { webresourceid: "two" }],
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch ${url}`);
  }) as any;

  try {
    const publisher = new PublisherService();
    const result = await publisher.publish(
      {
        relativeLocalPath: file,
        remotePath: "new_/web/script.js",
        solutionName: "CoreWebResources",
        kind: "file",
      },
      { name: "dev", url: "https://example", createMissingComponents: true },
      { accessToken: "token" },
      vscode.Uri.file(file),
    );

    assert.strictEqual(result.failed, 1);
    assert.strictEqual(calls.length, 2);
    const logs = (publisher as any).output.logs.join("\n");
    assert.match(logs, /Multiple web resources found/);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("buildError surfaces code and correlation id", async () => {
  const publisher = new PublisherService();
  const headers = new Headers({
    "x-ms-correlation-request-id": "corr-123",
    "x-ms-ags-diagnostic": '{"ServerResponseId":"diag-id"}',
  });
  const response = new Response(
    JSON.stringify({
      error: {
        code: "0x80040217",
        message: "Bad thing happened",
      },
    }),
    { status: 400, headers },
  );

  const error = await (publisher as any).buildError("Failed to test", response);

  assert.strictEqual((error as any).code, "0x80040217");
  assert.strictEqual((error as any).correlationId, "corr-123");
  assert.match(error.message, /0x80040217: Bad thing happened/);
});

test("publish returns cancellation result when token is cancelled", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-publish-"));
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];
  const file = path.join(workspaceRoot, "script.js");
  await fs.writeFile(file, "console.log('hi');");

  const token = {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose: () => {} }),
  } as vscode.CancellationToken;

  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ value: [] }), { status: 200 });
  }) as any;

  try {
    const publisher = new PublisherService();
    const result = await publisher.publish(
      {
        relativeLocalPath: file,
        remotePath: "new_/web/script.js",
        solutionName: "CoreWebResources",
        kind: "file",
      },
      { name: "dev", url: "https://example" },
      { accessToken: "token" },
      vscode.Uri.file(file),
      { cancellationToken: token },
    );

    assert.strictEqual(result.cancelled, true);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("publish creates a new web resource and adds it to the solution", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-publish-"));
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];
  const file = path.join(workspaceRoot, "script.js");
  await fs.writeFile(file, "console.log('hi');");

  const calls: Array<{ url: string; method: string | undefined }> = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: any, init: any = {}) => {
    const method = init.method || "GET";
    calls.push({ url: String(url), method });

    if (String(url).includes("/solutions?")) {
      return new Response(JSON.stringify({ value: [{ solutionid: "sol-id" }] }), {
        status: 200,
      });
    }
    if (String(url).includes("/webresourceset?")) {
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }
    if (String(url).includes("/webresourceset") && method === "POST") {
      return new Response(JSON.stringify({ webresourceid: "new-id" }), {
        status: 200,
      });
    }
    if (String(url).includes("/solutioncomponents?")) {
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }
    if (String(url).includes("/AddSolutionComponent")) {
      return new Response("{}", { status: 200 });
    }
    if (String(url).includes("/PublishXml")) {
      return new Response("{}", { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as any;

  try {
    const publisher = new PublisherService();
    const result = await publisher.publish(
      {
        relativeLocalPath: file,
        remotePath: "new_/web/script.js",
        solutionName: "CoreWebResources",
        kind: "file",
      },
      { name: "dev", url: "https://example", createMissingComponents: true },
      { accessToken: "token" },
      vscode.Uri.file(file),
    );

    assert.deepStrictEqual(result, {
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
    assert.strictEqual(calls.filter((c) => c.url.includes("/AddSolutionComponent")).length, 1);
    assert.strictEqual(calls.filter((c) => c.url.includes("/PublishXml")).length, 1);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("publish updates an existing web resource for folder binding", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-publish-"));
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];
  const folder = path.join(workspaceRoot, "web");
  const file = path.join(folder, "script.js");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(file, "console.log('hi');");

  const calls: Array<{ url: string; method: string | undefined }> = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: any, init: any = {}) => {
    const method = init.method || "GET";
    calls.push({ url: String(url), method });

    if (String(url).includes("/solutions?")) {
      return new Response(JSON.stringify({ value: [{ solutionid: "sol-id" }] }), {
        status: 200,
      });
    }
    if (String(url).includes("/webresourceset?")) {
      return new Response(JSON.stringify({ value: [{ webresourceid: "abc" }] }), {
        status: 200,
      });
    }
    if (String(url).includes("/webresourceset(") && method === "PATCH") {
      return new Response("{}", { status: 200 });
    }
    if (String(url).includes("/PublishXml")) {
      return new Response("{}", { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as any;

  try {
    const publisher = new PublisherService();
    const result = await publisher.publish(
      {
        relativeLocalPath: folder,
        remotePath: "new_/web",
        solutionName: "CoreWebResources",
        kind: "folder",
      },
      { name: "test", url: "https://example.test" },
      { accessToken: "token" },
      vscode.Uri.file(file),
    );

    assert.deepStrictEqual(result, {
      created: 0,
      updated: 1,
      skipped: 0,
      failed: 0,
    });
    const updateCall = calls.find((c) => c.method === "PATCH");
    assert.ok(updateCall?.url.includes("webresourceset(abc)"));
    assert.strictEqual(
      calls.some((c) => c.url.includes("AddSolutionComponent")),
      false,
    );
  } finally {
    global.fetch = originalFetch;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("publish skips when cache reports unchanged", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-publish-"));
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];
  const file = path.join(workspaceRoot, "script.js");
  await fs.writeFile(file, "console.log('hi');");

  const cache = {
    isUnchanged: async () => true,
    update: async () => {},
  } as any;

  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("fetch should not be called when cache hits");
  }) as any;

  try {
    const publisher = new PublisherService();
    const result = await publisher.publish(
      {
        relativeLocalPath: file,
        remotePath: "new_/web/script.js",
        solutionName: "CoreWebResources",
        kind: "file",
      },
      { name: "dev", url: "https://example" },
      { accessToken: "token" },
      vscode.Uri.file(file),
      { cache },
    );

    assert.deepStrictEqual(result, {
      created: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
  } finally {
    global.fetch = originalFetch;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("publish respects createMissingComponents=false and skips missing resource", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-publish-"));
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];
  const file = path.join(workspaceRoot, "script.js");
  await fs.writeFile(file, "console.log('hi');");

  const calls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: any, init: any = {}) => {
    calls.push(String(url));
    const method = init.method || "GET";

    if (String(url).includes("/solutions?")) {
      return new Response(JSON.stringify({ value: [{ solutionid: "sol-id" }] }), {
        status: 200,
      });
    }
    if (String(url).includes("/webresourceset?") && method === "GET") {
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as any;

  try {
    const publisher = new PublisherService();
    const result = await publisher.publish(
      {
        relativeLocalPath: file,
        remotePath: "new_/web/script.js",
        solutionName: "CoreWebResources",
        kind: "file",
      },
      { name: "prod", url: "https://example.prod", createMissingComponents: false },
      { accessToken: "token" },
      vscode.Uri.file(file),
    );

    assert.deepStrictEqual(result, {
      created: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
    assert.strictEqual(
      calls.some((c) => c.includes("/webresourceset(") || c.includes("/AddSolutionComponent")),
      false,
    );
  } finally {
    global.fetch = originalFetch;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
