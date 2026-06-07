import assert from "node:assert";
import test from "node:test";
import { DataverseClient, isDefaultSolution } from "../dataverseClient";
import { EnvironmentConnection } from "../environmentConnectionService";

function createResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

function createConnection(): EnvironmentConnection {
  return {
    env: { name: "dev" } as any,
    apiRoot: "https://example/api/data/v9.2",
    token: "token",
  };
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

test("request retries throttled responses with Retry-After delay", async () => {
  const calls: string[] = [];
  const delays: number[] = [];
  const fetchImpl = (async (url: any) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return createResponse(JSON.stringify({ error: { message: "too many requests" } }), {
        status: 429,
        headers: { "Retry-After": "2" },
      });
    }
    return createResponse(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const client = new DataverseClient(createConnection(), {
    fetch: fetchImpl,
    retryJitter: false,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  const result = await client.get<{ ok: boolean }>("/contacts");

  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(delays, [2000]);
});

test("request uses x-ms retry delay before exponential backoff", async () => {
  const delays: number[] = [];
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts += 1;
    if (attempts === 1) {
      return createResponse("", {
        status: 503,
        headers: { "x-ms-retry-after-ms": "1500" },
      });
    }
    return createResponse(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const client = new DataverseClient(createConnection(), {
    fetch: fetchImpl,
    retryDelayBaseMs: 10,
    retryJitter: false,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  await client.get("/contacts");

  assert.strictEqual(attempts, 2);
  assert.deepStrictEqual(delays, [1500]);
});

test("request does not retry non-transient errors", async () => {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts += 1;
    return createResponse(JSON.stringify({ error: { message: "bad request" } }), {
      status: 400,
    });
  }) as typeof fetch;

  const client = new DataverseClient(createConnection(), {
    fetch: fetchImpl,
    sleep: async () => {
      throw new Error("Sleep should not be called.");
    },
  });

  await assert.rejects(client.get("/contacts"), (error: any) =>
    error.message.includes("Dataverse GET /contacts: bad request (400)"),
  );
  assert.strictEqual(attempts, 1);
});

test("request stops retrying after max attempts", async () => {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts += 1;
    return createResponse(JSON.stringify({ error: { message: "busy" } }), {
      status: 503,
    });
  }) as typeof fetch;

  const client = new DataverseClient(createConnection(), {
    fetch: fetchImpl,
    maxAttempts: 2,
    retryDelayBaseMs: 10,
    retryJitter: false,
    sleep: async () => undefined,
  });

  await assert.rejects(client.get("/contacts"), (error: any) =>
    error.message.includes("Dataverse GET /contacts: busy (503)"),
  );
  assert.strictEqual(attempts, 2);
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

test("request forwards abort signal", async () => {
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
    };
    const controller = new AbortController();
    const client = new DataverseClient(connection);
    await client.post("/entities", { name: "test" }, { signal: controller.signal });

    assert.strictEqual(calls[0].options.signal, controller.signal);
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

test("request surfaces network fetch error details", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    const socketError = new Error("socket hang up") as Error & { code?: string };
    socketError.code = "ECONNRESET";
    const fetchError = new Error("fetch failed") as Error & { cause?: unknown };
    fetchError.cause = socketError;
    throw fetchError;
  }) as any;

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
        error.message.includes(
          "Dataverse GET /whoops: Network request failed for https://example/api/data/v9.2/whoops: fetch failed",
        ) &&
        error.code === "ECONNRESET" &&
        error.requestMethod === "GET" &&
        error.requestPath === "/whoops" &&
        error.requestUrl === "https://example/api/data/v9.2/whoops" &&
        error.causeCode === "ECONNRESET" &&
        error.causeMessage === "fetch failed" &&
        typeof error.causeChain === "string",
    );
  } finally {
    global.fetch = originalFetch!;
  }
});

test("isDefaultSolution matches default solution name case-insensitively", () => {
  assert.ok(isDefaultSolution("Default"));
  assert.ok(isDefaultSolution(" default "));
  assert.ok(!isDefaultSolution("Other"));
});
