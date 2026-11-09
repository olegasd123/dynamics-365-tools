import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import * as vscode from "vscode";
import type { CommandContext } from "@app/commandContext";
import type { EnvironmentConfig } from "@features/config/domain/models";
import type { DataverseRequestOptions } from "@features/dataverse/dataverseClient";
import { TestQuickPick } from "../../../testSupport/quickPick";
import {
  pickJavaScriptWebResource,
  searchJavaScriptWebResources,
} from "../commands/ribbonJavaScriptResourcePicker";
import {
  pickWebResourceLibrary,
  type WebResourceLibraryPick,
} from "../commands/ribbonResourcePrompts";

const dev = { name: "Dev", url: "https://dev.crm.dynamics.com" } as EnvironmentConfig;
const other = { name: "Other", url: "https://other.crm.dynamics.com" } as EnvironmentConfig;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup(
  t: TestContext,
  options: {
    get?: (url: string, options?: DataverseRequestOptions) => Promise<unknown>;
    environments?: EnvironmentConfig[];
    remembered?: string;
    loadLocal?: () => Promise<WebResourceLibraryPick[]>;
  } = {},
) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pickers: TestQuickPick<WebResourceLibraryPick>[] = [];
  const original = vscode.window.createQuickPick;
  vscode.window.createQuickPick = (() => {
    const picker = new TestQuickPick<WebResourceLibraryPick>();
    pickers.push(picker);
    return picker;
  }) as unknown as typeof vscode.window.createQuickPick;
  t.after(() => {
    for (const picker of pickers) {
      picker.dismiss();
    }
    vscode.window.createQuickPick = original;
  });
  let remembered = options.remembered;
  const connected: string[] = [];
  const ctx = {
    core: {
      configuration: {
        loadConfiguration: async () => ({ environments: options.environments ?? [dev] }),
      },
      lastSelection: {
        getLastEnvironment: () => remembered,
        setLastEnvironment: async (name: string) => {
          remembered = name;
        },
      },
      connections: {
        createClient: async (env: EnvironmentConfig) => {
          connected.push(env.name);
          return { get: options.get ?? (async () => ({ value: [] })) };
        },
      },
      ui: { pickEnvironment: async () => other },
    },
    webResource: { bindings: { listBindings: async () => ({ bindings: [] }) } },
  } as unknown as CommandContext;
  const result = pickJavaScriptWebResource(ctx, options.loadLocal ?? (async () => []));
  return { ctx, pickers, result, connected, picker: pickers[0] };
}

test("shows loading while local files load and keeps manual entry visible while typing", async (t) => {
  const local = deferred<WebResourceLibraryPick[]>();
  const { picker, result } = setup(t, { loadLocal: () => local.promise });
  assert.equal(picker.shown, true);
  assert.equal(picker.busy, true);
  assert.match(picker.title, /Loading/);
  picker.type("mso_");
  assert.equal(picker.items.find((item) => item.manual)?.alwaysShow, true);
  local.resolve([]);
  await flush();
  assert.equal(picker.busy, true);
  assert.match(picker.title, /Dev - Loading.*mso_/);
  picker.dismiss();
  assert.equal(await result, undefined);
  assert.equal(picker.disposed, true);
});

test("debounces typing, fetches the prefix remotely, and preserves bound file suggestions", async (t) => {
  const requested: string[] = [];
  const response = deferred<unknown>();
  const local = {
    label: "mso_/account.js",
    uniqueName: "mso_/account.js",
    localPath: "/workspace/account.js",
  };
  const { picker, result } = setup(t, {
    loadLocal: async () => [local],
    get: async (url) => {
      requested.push(url);
      return response.promise;
    },
  });
  await flush();
  assert.equal(picker.busy, false);
  assert.match(picker.title, /at least 2/);
  picker.type("m");
  t.mock.timers.tick(500);
  await flush();
  assert.equal(requested.length, 0);
  picker.type("ms");
  t.mock.timers.tick(150);
  picker.type("mso_");
  t.mock.timers.tick(299);
  await flush();
  assert.equal(requested.length, 0);
  assert.equal(picker.busy, true);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(requested.length, 1);
  assert.match(decodeURIComponent(requested[0]), /startswith\(name,'mso\[_\]'\)/);
  response.resolve({ value: [{ name: "mso_/account.js" }, { name: "mso_/remote.js" }] });
  await flush();
  assert.equal(picker.busy, false);
  assert.equal(picker.items.filter((item) => item.uniqueName === local.uniqueName).length, 1);
  assert.equal(picker.items[0].localPath, local.localPath);
  const remote = picker.items.find((item) => item.uniqueName === "mso_/remote.js");
  assert.ok(remote);
  picker.select(remote);
  assert.equal((await result)?.uniqueName, remote.uniqueName);
});

test("cancels older requests immediately and ignores stale results during debounce", async (t) => {
  const responses = [deferred<unknown>(), deferred<unknown>()];
  const signals: AbortSignal[] = [];
  const { picker } = setup(t, {
    get: async (_url, options) => {
      signals.push(options!.signal!);
      return responses[signals.length - 1].promise;
    },
  });
  await flush();
  picker.type("ms");
  t.mock.timers.tick(300);
  await flush();
  picker.type("mso_");
  assert.equal(signals[0].aborted, true);
  responses[0].resolve({ value: [{ name: "ms_old.js" }] });
  await flush();
  assert.equal(
    picker.items.some((item) => item.uniqueName === "ms_old.js"),
    false,
  );
  assert.equal(picker.busy, true);
  t.mock.timers.tick(300);
  await flush();
  responses[1].resolve({ value: [{ name: "mso_/new.js" }] });
  await flush();
  assert.equal(picker.busy, false);
  assert.ok(picker.items.some((item) => item.uniqueName === "mso_/new.js"));
});

test("clearing the query cancels work and prevents late failures changing the picker", async (t) => {
  const response = deferred<unknown>();
  let signal: AbortSignal | undefined;
  const { picker } = setup(t, {
    get: async (_url, options) => {
      signal = options?.signal;
      return response.promise;
    },
  });
  await flush();
  picker.type("mso_");
  t.mock.timers.tick(300);
  await flush();
  picker.type("");
  assert.equal(signal?.aborted, true);
  assert.equal(picker.busy, false);
  response.reject(new Error("Old failure"));
  await flush();
  assert.match(picker.title, /at least 2/);
});

test("shows errors and empty results above the list even when text is entered", async (t) => {
  let calls = 0;
  const { picker } = setup(t, {
    get: async () => {
      if (++calls === 1) {
        throw new Error("Access denied");
      }
      return { value: [] };
    },
  });
  await flush();
  picker.type("mso_");
  t.mock.timers.tick(300);
  await flush();
  assert.equal(picker.busy, false);
  assert.match(picker.title, /Search failed: Access denied/);
  picker.type("mso_/missing");
  t.mock.timers.tick(300);
  await flush();
  assert.match(picker.title, /No JavaScript web resources found/);
  assert.equal(picker.busy, false);
});

test("times out a stalled search, aborts it, and supports another search", async (t) => {
  const response = deferred<unknown>();
  const signals: AbortSignal[] = [];
  const { picker } = setup(t, {
    get: async (_url, options) => {
      signals.push(options!.signal!);
      return signals.length === 1 ? response.promise : { value: [{ name: "mso_/new.js" }] };
    },
  });
  await flush();
  picker.type("mso_");
  t.mock.timers.tick(300);
  await flush();
  t.mock.timers.tick(30_000);
  assert.equal(signals[0].aborted, true);
  assert.equal(picker.busy, false);
  assert.match(picker.title, /Search timed out/);
  picker.type("mso_/new");
  t.mock.timers.tick(300);
  await flush();
  response.resolve({ value: [{ name: "mso_/old.js" }] });
  await flush();
  assert.match(picker.title, /1 environment matches/);
  assert.ok(picker.items.some((item) => item.uniqueName === "mso_/new.js"));
  assert.equal(
    picker.items.some((item) => item.uniqueName === "mso_/old.js"),
    false,
  );
});

test("closing the picker cancels active requests and pending debounce timers", async (t) => {
  const response = deferred<unknown>();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const { picker, result } = setup(t, {
    get: async (_url, options) => {
      calls++;
      signal = options?.signal;
      return response.promise;
    },
  });
  await flush();
  picker.type("ms");
  t.mock.timers.tick(300);
  await flush();
  picker.type("mso_");
  const title = picker.title;
  picker.dismiss();
  assert.equal(await result, undefined);
  assert.equal(signal?.aborted, true);
  t.mock.timers.tick(31_000);
  response.resolve({ value: [{ name: "ms_old.js" }] });
  await flush();
  assert.equal(calls, 1);
  assert.equal(picker.title, title);
});

test("caps a broad search and never downloads every page in a large environment", async (t) => {
  let calls = 0;
  const { picker } = setup(t, {
    get: async (url) => {
      calls++;
      assert.equal(new URL(url, dev.url).searchParams.get("$top"), "101");
      return {
        value: Array.from({ length: 101 }, (_, i) => ({ name: `mso_/script${i}.js` })),
        "@odata.nextLink": "/webresourceset?next-page-of-100000-resources",
      };
    },
  });
  await flush();
  picker.type("mso_");
  t.mock.timers.tick(300);
  await flush();
  assert.equal(calls, 1);
  assert.equal(picker.items.filter((item) => item.uniqueName).length, 100);
  assert.match(picker.title, /Showing first 100.*Type more/);
});

test("uses the remembered environment and keeps the query when changing environments", async (t) => {
  const { picker, pickers, connected } = setup(t, {
    environments: [dev, other],
    remembered: "Dev",
  });
  await flush();
  picker.type("mso_");
  t.mock.timers.tick(300);
  await flush();
  assert.deepEqual(connected, ["Dev"]);
  picker.select(picker.items.find((item) => item.label === "Change environment..."));
  await flush();
  assert.equal(picker.disposed, true);
  const second = pickers[1];
  assert.equal(second.value, "mso_");
  assert.match(second.title, /Other - Loading/);
  t.mock.timers.tick(300);
  await flush();
  assert.deepEqual(connected, ["Dev", "Other"]);
});

test("requires a choice when several environments exist without a remembered selection", async (t) => {
  const { picker, connected } = setup(t, { environments: [dev, other] });
  await flush();
  picker.type("mso_");
  t.mock.timers.tick(300);
  await flush();
  assert.deepEqual(connected, []);
  assert.match(picker.title, /Select an environment/);
  assert.equal(
    picker.items.find((item) => item.label === "Select environment to search...")?.alwaysShow,
    true,
  );
});

test("supports local and manual selection without a configured environment", async (t) => {
  const local = {
    label: "new_/local.js",
    uniqueName: "new_/local.js",
    localPath: "/workspace/local.js",
  };
  const { picker, ctx, pickers, result, connected } = setup(t, {
    environments: [],
    loadLocal: async () => [local],
  });
  await flush();
  assert.match(picker.title, /No environments configured/);
  picker.select(local);
  assert.equal(await result, local);
  const originalInput = vscode.window.showInputBox;
  vscode.window.showInputBox = async () => "$webresource:new_\\manual.js";
  t.after(() => {
    vscode.window.showInputBox = originalInput;
  });
  const manualResult = pickWebResourceLibrary(ctx);
  await flush();
  const manualPicker = pickers[1];
  manualPicker.type("new_");
  manualPicker.select(manualPicker.items.find((item) => item.manual));
  assert.equal((await manualResult)?.uniqueName, "new_/manual.js");
  assert.deepEqual(connected, []);
});

test("shows local loading failures", async (t) => {
  const local = deferred<WebResourceLibraryPick[]>();
  const { picker } = setup(t, { loadLocal: () => local.promise });
  local.reject(new Error("Cannot read bindings"));
  await flush();
  assert.equal(picker.busy, false);
  assert.match(picker.title, /Loading failed: Cannot read bindings/);
  assert.ok(picker.items.some((item) => item.manual));
});

test("closing during initial loading prevents later UI changes or searches", async (t) => {
  const local = deferred<WebResourceLibraryPick[]>();
  const { picker, result, connected } = setup(t, { loadLocal: () => local.promise });
  picker.type("mso_");
  const title = picker.title;
  picker.dismiss();
  assert.equal(await result, undefined);
  local.resolve([{ label: "mso_/late.js", uniqueName: "mso_/late.js" }]);
  await flush();
  t.mock.timers.tick(1000);
  await flush();
  assert.deepEqual(connected, []);
  assert.equal(
    picker.items.some((item) => item.uniqueName === "mso_/late.js"),
    false,
  );
  assert.equal(picker.title, title);
});

test("does not send short queries and passes cancellation to the Dataverse client", async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = {
    get: async <T>(_url: string, options?: DataverseRequestOptions): Promise<T> => {
      calls++;
      assert.equal(options?.signal, controller.signal);
      return { value: [{ name: "mso_/account.js" }] } as T;
    },
  };
  assert.deepEqual(await searchJavaScriptWebResources(client, "m"), { picks: [], hasMore: false });
  assert.equal(calls, 0);
  const result = await searchJavaScriptWebResources(client, "mso_", controller.signal);
  assert.equal(result.picks[0].uniqueName, "mso_/account.js");
  assert.equal(result.hasMore, false);
  assert.equal(calls, 1);
});
