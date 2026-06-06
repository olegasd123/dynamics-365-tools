import assert from "node:assert";
import test from "node:test";
import * as path from "path";
import * as vscode from "vscode";
import { MemoryWorkspaceFiles } from "../../../testSupport/fakes";
import { DataverseClient } from "../../dataverse/dataverseClient";
import { WebResourcePublisher } from "../webResourcePublisher";

class FakeConnections {
  async createConnection(env: { name: string; url: string }, auth: { accessToken?: string }) {
    return {
      env,
      apiRoot: `${env.url.replace(/\/+$/, "")}/api/data/v9.2`,
      token: auth.accessToken ?? "token",
      userAgent: undefined,
    };
  }

  async createClient(env: { name: string; url: string }, auth: { accessToken?: string }) {
    const connection = await this.createConnection(env, auth);
    return new DataverseClient(connection as any);
  }
}

function createWorkspace(): { workspaceRoot: string; files: MemoryWorkspaceFiles } {
  const workspaceRoot = path.join("/workspace", "project");
  return { workspaceRoot, files: new MemoryWorkspaceFiles(workspaceRoot) };
}

function createPublisher(files: MemoryWorkspaceFiles): WebResourcePublisher {
  return new WebResourcePublisher(new FakeConnections() as any, files);
}

test("resolvePaths maps folder bindings to nested files", async () => {
  const { workspaceRoot, files } = createWorkspace();
  const folder = path.join(workspaceRoot, "web");
  const file = path.join(folder, "script.js");
  files.addFile(file, "console.log('hi');");

  const publisher = createPublisher(files);
  const paths = await (publisher as any).resolvePaths(
    {
      relativeLocalPath: path.join(path.basename(workspaceRoot), "web"),
      remotePath: "new_/web",
      solutionName: "CoreWebResources",
      kind: "folder",
    },
    vscode.Uri.file(file),
  );

  assert.strictEqual(paths.localPath, file);
  assert.strictEqual(paths.remotePath, "new_/web/script.js");
});

test("resolvePaths rejects publishing a directory target", async () => {
  const { workspaceRoot, files } = createWorkspace();
  const folder = path.join(workspaceRoot, "web");
  files.addDirectory(folder);

  const publisher = createPublisher(files);
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
});

test("detectType maps known extensions to correct codes", () => {
  const publisher = createPublisher(createWorkspace().files);
  assert.strictEqual((publisher as any).detectType("file.css"), 2);
  assert.strictEqual((publisher as any).detectType("file.js"), 3);
  assert.strictEqual((publisher as any).detectType("file.xml"), 4);
  assert.strictEqual((publisher as any).detectType("file.png"), 5);
  assert.strictEqual((publisher as any).detectType("file.xsl"), 9);
  assert.strictEqual((publisher as any).detectType("file.ico"), 10);
  assert.strictEqual((publisher as any).detectType("file.svg"), 11);
  assert.strictEqual((publisher as any).detectType("file.resx"), 12);
});

test("publish fails fast when solution is missing", async () => {
  const { workspaceRoot, files } = createWorkspace();
  const file = path.join(workspaceRoot, "script.js");
  files.addFile(file, "console.log('hi');");

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
    const publisher = createPublisher(files);
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
  }
});

test("publish aborts when remotePath matches multiple resources", async () => {
  const { workspaceRoot, files } = createWorkspace();
  const file = path.join(workspaceRoot, "script.js");
  files.addFile(file, "console.log('hi');");

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
    const publisher = createPublisher(files);
    const result = await publisher.publish(
      {
        relativeLocalPath: file,
        remotePath: "new_/web/script.js",
        solutionName: "CoreWebResources",
        kind: "file",
      },
      { name: "dev", url: "https://example", manageMissingComponents: true },
      { accessToken: "token" },
      vscode.Uri.file(file),
    );

    assert.strictEqual(result.failed, 1);
    assert.strictEqual(calls.length, 2);
    const logs = (publisher as any).output.logs.join("\n");
    assert.match(logs, /Multiple web resources found/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("publish returns cancellation result when token is cancelled", async () => {
  const { workspaceRoot, files } = createWorkspace();
  const file = path.join(workspaceRoot, "script.js");
  files.addFile(file, "console.log('hi');");

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
    const publisher = createPublisher(files);
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
  }
});

test("publish creates a new web resource and adds it to the solution", async () => {
  const { workspaceRoot, files } = createWorkspace();
  const file = path.join(workspaceRoot, "script.js");
  files.addFile(file, "console.log('hi');");

  const calls: Array<{ url: string; method: string | undefined; body?: string }> = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: any, init: any = {}) => {
    const method = init.method || "GET";
    calls.push({ url: String(url), method, body: init.body });

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
    const publisher = createPublisher(files);
    const result = await publisher.publish(
      {
        relativeLocalPath: file,
        remotePath: "new_/web/script.js",
        solutionName: "CoreWebResources",
        kind: "file",
      },
      { name: "dev", url: "https://example", manageMissingComponents: true },
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
    const createCall = calls.find((c) => c.method === "POST" && c.url.includes("/webresourceset"));
    const createBody = JSON.parse(createCall?.body ?? "{}") as { displayname?: string };
    assert.strictEqual(createBody.displayname, "script.js");
  } finally {
    global.fetch = originalFetch;
  }
});

test("publish updates an existing web resource for folder binding", async () => {
  const { workspaceRoot, files } = createWorkspace();
  const folder = path.join(workspaceRoot, "web");
  const file = path.join(folder, "script.js");
  files.addFile(file, "console.log('hi');");

  const calls: Array<{ url: string; method: string | undefined; body?: string }> = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: any, init: any = {}) => {
    const method = init.method || "GET";
    calls.push({ url: String(url), method, body: init.body });

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
    const publisher = createPublisher(files);
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
    const updateBody = JSON.parse(updateCall?.body ?? "{}") as { displayname?: string };
    assert.strictEqual("displayname" in updateBody, false);
    assert.strictEqual(
      calls.some((c) => c.url.includes("AddSolutionComponent")),
      false,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("publish skips when cache reports unchanged", async () => {
  const { workspaceRoot, files } = createWorkspace();
  const file = path.join(workspaceRoot, "script.js");
  files.addFile(file, "console.log('hi');");

  const cache = {
    isUnchanged: async () => true,
    update: async () => {},
  } as any;

  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("fetch should not be called when cache hits");
  }) as any;

  try {
    const publisher = createPublisher(files);
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
  }
});

test("publish respects manageMissingComponents=false and skips missing resource", async () => {
  const { workspaceRoot, files } = createWorkspace();
  const file = path.join(workspaceRoot, "script.js");
  files.addFile(file, "console.log('hi');");

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
    const publisher = createPublisher(files);
    const result = await publisher.publish(
      {
        relativeLocalPath: file,
        remotePath: "new_/web/script.js",
        solutionName: "CoreWebResources",
        kind: "file",
      },
      { name: "prod", url: "https://example.prod", manageMissingComponents: false },
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
  }
});
