import assert from "node:assert";
import test from "node:test";
import { DataverseClient, isDefaultSolution } from "../dataverseClient";
import { EnvironmentConnection } from "../environmentConnectionService";

function createResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

test("request builds full URL and headers for GET", async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: any, options: any) => {
    calls.push({ url: String(url), options: options ?? {} });
    return createResponse(JSON.stringify({ ok: true }), { status: 200 });
  }) as any;

  try {
    const connection: EnvironmentConnection = {
      env: { name: "dev" } as any,
      apiRoot: "https://example/api/data/v9.2",
      token: "token",
    };
    const client = new DataverseClient(connection);
    const result = await client.get<{ ok: boolean }>("/contacts");

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(calls[0].url, "https://example/api/data/v9.2/contacts");
    assert.strictEqual(calls[0].options.method, "GET");
    assert.strictEqual((calls[0].options.headers as any).Authorization, "Bearer token");
    assert.strictEqual((calls[0].options.headers as any).Accept, "application/json");
    assert.ok(!(calls[0].options.headers as any)["Prefer"]);
  } finally {
    global.fetch = originalFetch!;
  }
});

test("post adds content headers, prefer, and user-agent", async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: any, options: any) => {
    calls.push({ url: String(url), options: options ?? {} });
    return createResponse("{}", { status: 200 });
  }) as any;

  try {
    const connection: EnvironmentConnection = {
      env: { name: "dev" } as any,
      apiRoot: "https://example/api/data/v9.2",
      token: "token",
      userAgent: "custom-agent",
    };
    const client = new DataverseClient(connection);
    await client.post("/entities", { name: "test" });

    const opts = calls[0].options;
    assert.strictEqual(opts.method, "POST");
    assert.strictEqual((opts.headers as any)["Content-Type"], "application/json");
    assert.strictEqual((opts.headers as any).Prefer, "return=representation");
    assert.strictEqual((opts.headers as any)["User-Agent"], "custom-agent");
    assert.strictEqual(opts.body, JSON.stringify({ name: "test" }));
  } finally {
    global.fetch = originalFetch!;
  }
});

test("request normalizes absolute paths", async () => {
  const calls: Array<{ url: string }> = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: any) => {
    calls.push({ url: String(url) });
    return createResponse("{}", { status: 200 });
  }) as any;

  try {
    const connection: EnvironmentConnection = {
      env: { name: "dev" } as any,
      apiRoot: "https://example/api/data/v9.2",
      token: "token",
    };
    const client = new DataverseClient(connection);
    await client.get("https://other/absolute");
    assert.strictEqual(calls[0].url, "https://other/absolute");
  } finally {
    global.fetch = originalFetch!;
  }
});

test("request surfaces detailed errors with correlation id", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    createResponse(JSON.stringify({ error: { message: "fail", code: "0x0" } }), {
      status: 400,
      headers: { "x-ms-request-id": "corr-123" },
    })) as any;

  try {
    const connection: EnvironmentConnection = {
      env: { name: "dev" } as any,
      apiRoot: "https://example/api/data/v9.2",
      token: "token",
    };
    const client = new DataverseClient(connection);
    await assert.rejects(
      client.get("/whoops"),
      (error: any) =>
        error.message.includes("Dataverse GET /whoops: 0x0: fail (400)") &&
        error.code === "0x0" &&
        error.correlationId === "corr-123" &&
        error.status === 400 &&
        typeof error.rawBody === "string",
    );
  } finally {
    global.fetch = originalFetch!;
  }
});

test("getCreatedId returns ids from body or headers", async () => {
  const connection: EnvironmentConnection = {
    env: { name: "dev" } as any,
    apiRoot: "https://example/api/data/v9.2",
    token: "token",
  };
  const client = new DataverseClient(connection);

  const fromId = await client.getCreatedId(
    createResponse(JSON.stringify({ id: "abc" }), { status: 201 }),
  );
  const fromAssembly = await client.getCreatedId(
    createResponse(JSON.stringify({ pluginassemblyid: "def" }), { status: 201 }),
  );
  const fromHeader = await client.getCreatedId(
    new Response(null, {
      status: 204,
      headers: {
        "OData-EntityId": "https://example/records/00000000-0000-0000-0000-000000000001",
      },
    }),
  );

  assert.strictEqual(fromId, "abc");
  assert.strictEqual(fromAssembly, "def");
  assert.strictEqual(fromHeader, "00000000-0000-0000-0000-000000000001");
});

test("isDefaultSolution matches default solution name case-insensitively", () => {
  assert.ok(isDefaultSolution("Default"));
  assert.ok(isDefaultSolution(" default "));
  assert.ok(!isDefaultSolution("Other"));
});
