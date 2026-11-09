import * as vscode from "vscode";
import type { CommandContext } from "@app/commandContext";
import type { Dynamics365Configuration, EnvironmentConfig } from "@features/config/domain/models";
import type { DataverseClient } from "@features/dataverse/dataverseClient";
import type { WebResourceLibraryPick } from "./ribbonResourcePrompts";
import {
  buildJavaScriptWebResourceQueryUrl,
  normalizeWebResourceUniqueName,
  uniqueByWebResourceUniqueName,
  WEB_RESOURCE_SEARCH_LIMIT,
} from "./ribbonResourcePromptSupport";

interface LibraryPick extends WebResourceLibraryPick {
  chooseEnvironment?: boolean;
}

interface LibrarySource {
  config: Dynamics365Configuration;
  localPicks: WebResourceLibraryPick[];
  environment?: EnvironmentConfig;
}

export async function pickJavaScriptWebResource(
  ctx: CommandContext,
  loadLocalPicks: () => Promise<WebResourceLibraryPick[]>,
): Promise<WebResourceLibraryPick | undefined> {
  let source = Promise.all([ctx.core.configuration.loadConfiguration(), loadLocalPicks()]).then(
    ([config, localPicks]): LibrarySource => ({
      config,
      localPicks,
      environment:
        config.environments.find(
          (env) => env.name === ctx.core.lastSelection.getLastEnvironment(),
        ) ?? (config.environments.length === 1 ? config.environments[0] : undefined),
    }),
  );
  let value = "";

  while (true) {
    const result = await showLibraryPicker(ctx, source, value);
    if (!result.pick?.chooseEnvironment) {
      return result.pick;
    }

    const loaded = await source;
    const environment = await ctx.core.ui.pickEnvironment(
      loaded.config.environments,
      loaded.environment?.name,
      { placeHolder: "Select environment for JavaScript resources" },
    );
    if (environment) {
      await ctx.core.lastSelection.setLastEnvironment(environment.name);
    }
    source = Promise.resolve({ ...loaded, environment: environment ?? loaded.environment });
    value = result.value;
  }
}

function showLibraryPicker(
  ctx: CommandContext,
  source: Promise<LibrarySource>,
  value: string,
): Promise<{ pick?: LibraryPick; value: string }> {
  const quickPick = vscode.window.createQuickPick<LibraryPick>();
  const manual: LibraryPick = {
    label: "Type schema name manually",
    description: "Use an external or unbound web resource",
    uniqueName: "",
    manual: true,
    alwaysShow: true,
  };
  const disposables: vscode.Disposable[] = [];
  let loaded: LibrarySource | undefined;
  let client: Promise<DataverseClient | undefined> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let settled = false;

  quickPick.ignoreFocusOut = true;
  quickPick.matchOnDescription = true;
  quickPick.placeholder = "JavaScript web resource";
  quickPick.value = value;
  quickPick.busy = true;
  quickPick.title = "Loading JavaScript web resources...";
  quickPick.items = [manual];

  const setStatus = (status: string) => {
    quickPick.title = loaded?.environment ? `${loaded.environment.name} - ${status}` : status;
  };
  const setItems = (remote: WebResourceLibraryPick[] = []) => {
    quickPick.items = [
      ...uniqueByWebResourceUniqueName([...(loaded?.localPicks ?? []), ...remote]),
      ...(loaded?.config.environments.length
        ? [
            {
              label: loaded.environment
                ? "Change environment..."
                : "Select environment to search...",
              description: loaded.environment?.name,
              uniqueName: "",
              chooseEnvironment: true,
              alwaysShow: true,
            },
          ]
        : []),
      manual,
    ];
  };
  const cancelSearch = () => {
    clearTimeout(debounce);
    clearTimeout(timeout);
    request?.abort();
    request = undefined;
  };

  const search = async (query: string) => {
    if (!loaded?.environment || settled) {
      return;
    }
    const controller = new AbortController();
    request = controller;
    const searchTimeout = setTimeout(() => {
      controller.abort();
      if (!settled && request === controller) {
        quickPick.busy = false;
        setStatus("Search timed out. Type more of the name or try again.");
      }
    }, 30_000);
    timeout = searchTimeout;

    try {
      client ??= ctx.core.connections.createClient(loaded.environment).catch((error: unknown) => {
        client = undefined;
        throw error;
      });
      const connectedClient = await client;
      if (controller.signal.aborted) {
        return;
      }
      if (!connectedClient) {
        client = undefined;
        throw new Error("Sign in to this environment, then try again.");
      }
      const result = await searchJavaScriptWebResources(connectedClient, query, controller.signal);
      if (settled || controller.signal.aborted) {
        return;
      }
      setItems(result.picks);
      setStatus(
        result.hasMore
          ? `Showing first ${WEB_RESOURCE_SEARCH_LIMIT} environment matches. Type more of the name.`
          : result.picks.length
            ? `${result.picks.length} environment matches for "${query}".`
            : `No JavaScript web resources found in this environment for "${query}".`,
      );
    } catch (error) {
      if (!settled && !controller.signal.aborted) {
        setStatus(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      clearTimeout(searchTimeout);
      if (!settled && request === controller) {
        quickPick.busy = false;
      }
    }
  };

  const update = () => {
    cancelSearch();
    if (!loaded || settled) {
      return;
    }
    setItems();
    const query = normalizeWebResourceUniqueName(quickPick.value);
    quickPick.busy = false;
    if (!loaded.environment) {
      setStatus(
        loaded.config.environments.length
          ? "Select an environment to search. Local resources are shown below."
          : "No environments configured. Local resources are shown below.",
      );
    } else if (query.length < 2) {
      setStatus("Type at least 2 characters from the start of the web resource name.");
    } else {
      quickPick.busy = true;
      setStatus(`Loading JavaScript web resources for "${query}"...`);
      debounce = setTimeout(() => void search(query), 300);
    }
  };

  return new Promise((resolve) => {
    const finish = (pick?: LibraryPick) => {
      if (settled) {
        return;
      }
      settled = true;
      cancelSearch();
      const typedValue = quickPick.value;
      for (const disposable of disposables) {
        disposable.dispose();
      }
      quickPick.dispose();
      resolve({ pick, value: typedValue });
    };
    disposables.push(
      quickPick.onDidChangeValue(update),
      quickPick.onDidAccept(() => {
        const pick = quickPick.selectedItems[0];
        if (pick) {
          finish(pick);
        }
      }),
      quickPick.onDidHide(() => finish()),
    );
    quickPick.show();
    void source.then(
      (result) => {
        if (!settled) {
          loaded = result;
          update();
        }
      },
      (error: unknown) => {
        if (!settled) {
          quickPick.busy = false;
          setStatus(`Loading failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    );
  });
}

export async function searchJavaScriptWebResources(
  client: Pick<DataverseClient, "get">,
  query: string,
  signal?: AbortSignal,
): Promise<{ picks: WebResourceLibraryPick[]; hasMore: boolean }> {
  const url = buildJavaScriptWebResourceQueryUrl(query);
  if (!url) {
    return { picks: [], hasMore: false };
  }
  const response = await client.get<{
    value?: Array<{ name?: string; displayname?: string }>;
    "@odata.nextLink"?: string;
  }>(url, { signal });
  const rows = response.value ?? [];
  const picks = rows.slice(0, WEB_RESOURCE_SEARCH_LIMIT).flatMap((item) => {
    const uniqueName = normalizeWebResourceUniqueName(item.name ?? "");
    return uniqueName
      ? [{ label: uniqueName, description: item.displayname?.trim(), uniqueName }]
      : [];
  });
  return {
    picks: uniqueByWebResourceUniqueName(picks),
    hasMore: rows.length > WEB_RESOURCE_SEARCH_LIMIT || !!response["@odata.nextLink"],
  };
}
