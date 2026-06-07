import * as path from "node:path";
import * as vscode from "vscode";
import { CommandContext } from "@app/commandContext";
import { pickDataverseClient } from "@app/commandUtils";
import { WorkspaceFileType, type WorkspaceFilesPort } from "@app/ports/files";
import { BindingEntry } from "@features/config/domain/models";
import type { DataverseClient } from "@features/dataverse/dataverseClient";
import { showRibbonInputBox, showRibbonQuickPick } from "./ribbonPromptUi";
import {
  buildImageWebResourceQueryUrl,
  currentFunctionFirst,
  imageWebResourceExtensionLabel,
  imageWebResourceTypeLabel,
  isCurrentFunctionSuggestion,
  isImageWebResourceName,
  joinRemotePath,
  normalizeWebResourceUniqueName,
  uniqueByWebResourceUniqueName,
  withDefaultJavaScriptFunctionSuggestions,
} from "./ribbonResourcePromptSupport";

export { normalizeWebResourceUniqueName };

export interface WebResourceLibraryPick extends vscode.QuickPickItem {
  uniqueName: string;
  localPath?: string;
  manual?: boolean;
}

type RibbonImageWebResourceKind = "image16x16" | "image32x32" | "modernImage";

interface ImageWebResourcePrompt {
  prompt: string;
  placeHolder: string;
}

const IMAGE_WEB_RESOURCE_PROMPTS: Record<RibbonImageWebResourceKind, ImageWebResourcePrompt> = {
  image16x16: {
    prompt: "Image 16 web resource",
    placeHolder: "new_/account/image16x16.png",
  },
  image32x32: {
    prompt: "Image 32 web resource",
    placeHolder: "new_/account/image32x32.png",
  },
  modernImage: {
    prompt: "Modern image web resource",
    placeHolder: "new_/account/image.svg",
  },
};

export async function pickImageWebResource(
  ctx: CommandContext,
  kind: RibbonImageWebResourceKind,
  currentUniqueName?: string,
): Promise<string | undefined> {
  const prompt = IMAGE_WEB_RESOURCE_PROMPTS[kind];
  const mode = await showRibbonQuickPick(
    [
      { label: "Fill manually", description: "Type a web resource name" },
      { label: "Pick from environment", description: "Use a Dataverse image web resource" },
    ],
    { placeHolder: prompt.prompt },
  );
  if (!mode) {
    return undefined;
  }

  if (mode.label === "Fill manually") {
    return promptImageWebResourceManually(prompt, currentUniqueName);
  }

  const picked = await pickImageWebResourceFromEnvironment(ctx, prompt, currentUniqueName);
  return picked?.uniqueName;
}

async function promptImageWebResourceManually(
  prompt: ImageWebResourcePrompt,
  currentUniqueName?: string,
): Promise<string | undefined> {
  return showRibbonInputBox({
    prompt: prompt.prompt,
    placeHolder: prompt.placeHolder,
    value: currentUniqueName ?? "",
  });
}

async function pickImageWebResourceFromEnvironment(
  ctx: CommandContext,
  prompt: ImageWebResourcePrompt,
  currentUniqueName?: string,
): Promise<WebResourceLibraryPick | undefined> {
  const config = await ctx.core.configuration.loadConfiguration();
  const target = await pickDataverseClient(ctx, {
    config,
    placeHolder: "Select environment for image resources",
  });
  if (!target) {
    return undefined;
  }

  const client = target.client;
  return pickEnvironmentImageWebResource(client, prompt, target.env.name, currentUniqueName);
}

function pickEnvironmentImageWebResource(
  client: Pick<DataverseClient, "get">,
  prompt: ImageWebResourcePrompt,
  environmentName: string,
  currentUniqueName?: string,
): Promise<WebResourceLibraryPick | undefined> {
  const quickPick = vscode.window.createQuickPick<WebResourceLibraryPick>();
  const disposables: vscode.Disposable[] = [];
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let requestId = 0;
  let settled = false;

  quickPick.ignoreFocusOut = true;
  quickPick.matchOnDescription = true;
  quickPick.placeholder = "Type at least 2 characters to search image web resources.";
  quickPick.title = `${prompt.prompt} - ${environmentName}`;
  quickPick.items = currentWebResourceFirst([], currentUniqueName);

  const cleanup = () => {
    if (debounce) {
      clearTimeout(debounce);
      debounce = undefined;
    }
    for (const disposable of disposables) {
      disposable.dispose();
    }
    quickPick.dispose();
  };

  const resolveOnce = (
    resolve: (value: WebResourceLibraryPick | undefined) => void,
    value: WebResourceLibraryPick | undefined,
  ) => {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    resolve(value);
  };

  return new Promise<WebResourceLibraryPick | undefined>((resolve) => {
    const search = async (value: string) => {
      const query = value.trim();
      requestId += 1;
      const currentRequest = requestId;

      if (query.length < 2) {
        quickPick.busy = false;
        quickPick.placeholder = "Type at least 2 characters to search image web resources.";
        quickPick.items = currentWebResourceFirst([], currentUniqueName);
        return;
      }

      quickPick.busy = true;
      quickPick.placeholder = `Searching image web resources for "${query}"...`;
      try {
        const picks = await listEnvironmentImageWebResources(client, query);
        if (currentRequest !== requestId) {
          return;
        }

        quickPick.items = currentWebResourceFirst(picks, currentUniqueName);
        quickPick.placeholder = picks.length
          ? prompt.prompt
          : `No image web resources found for "${query}".`;
      } catch (error) {
        if (currentRequest !== requestId) {
          return;
        }
        quickPick.items = currentWebResourceFirst([], currentUniqueName);
        quickPick.placeholder = `Search failed: ${describeError(error)}`;
      } finally {
        if (currentRequest === requestId) {
          quickPick.busy = false;
        }
      }
    };

    disposables.push(
      quickPick.onDidChangeValue((value) => {
        if (debounce) {
          clearTimeout(debounce);
        }
        debounce = setTimeout(() => {
          void search(value);
        }, 300);
      }),
      quickPick.onDidAccept(() => {
        resolveOnce(resolve, quickPick.selectedItems[0]);
      }),
      quickPick.onDidHide(() => {
        resolveOnce(resolve, undefined);
      }),
    );

    quickPick.show();
  });
}

export async function pickWebResourceLibrary(
  ctx: CommandContext,
  currentUniqueName?: string,
): Promise<WebResourceLibraryPick | undefined> {
  const picks = currentWebResourceFirst(await listBoundJavaScriptLibraries(ctx), currentUniqueName);
  const manualPick: WebResourceLibraryPick = {
    label: "Type schema name manually",
    description: "Use an external or unbound web resource",
    uniqueName: "",
    manual: true,
  };

  const pick = await showRibbonQuickPick([...picks, manualPick], {
    placeHolder: "JavaScript web resource",
  });
  if (!pick) {
    return undefined;
  }

  if (!pick.manual) {
    return pick;
  }

  const uniqueName = await showRibbonInputBox({
    prompt: "JavaScript web resource schema name",
    placeHolder: "new_/scripts/account.js",
    value: currentUniqueName ?? "",
    validateInput: (value) =>
      normalizeWebResourceUniqueName(value) ? undefined : "Schema name is required.",
  });
  const normalized = normalizeWebResourceUniqueName(uniqueName ?? "");

  return normalized
    ? {
        label: normalized,
        uniqueName: normalized,
      }
    : undefined;
}

export async function listBoundJavaScriptLibraries(
  ctx: CommandContext,
): Promise<WebResourceLibraryPick[]> {
  const snapshot = await ctx.webResource.bindings.listBindings();
  const picks: WebResourceLibraryPick[] = [];

  for (const binding of snapshot.bindings) {
    if (binding.kind === "file") {
      const uniqueName = binding.remotePath.replace(/\\/g, "/");
      if (uniqueName.toLowerCase().endsWith(".js")) {
        picks.push({
          label: uniqueName,
          description: ctx.core.configuration.getRelativeToWorkspace(
            ctx.core.configuration.resolveLocalPath(binding.relativeLocalPath),
          ),
          uniqueName,
          localPath: ctx.core.configuration.resolveLocalPath(binding.relativeLocalPath),
        });
      }
      continue;
    }

    picks.push(...(await listFolderJavaScriptLibraries(ctx, binding)));
  }

  return uniqueByWebResourceUniqueName(picks).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

export async function listEnvironmentImageWebResources(
  client: Pick<DataverseClient, "get">,
  searchText?: string,
): Promise<WebResourceLibraryPick[]> {
  const initialUrl = buildImageWebResourceQueryUrl(searchText);
  if (!initialUrl) {
    return [];
  }

  let url = initialUrl;
  const picks: WebResourceLibraryPick[] = [];

  while (url) {
    const response = await client.get<{
      value?: Array<{ name?: string; displayname?: string; webresourcetype?: number }>;
      "@odata.nextLink"?: string;
    }>(url);

    for (const item of response.value ?? []) {
      const uniqueName = normalizeWebResourceUniqueName(item.name ?? "");
      if (!uniqueName || !isImageWebResourceName(uniqueName)) {
        continue;
      }

      picks.push({
        label: uniqueName,
        description:
          item.displayname?.trim() ||
          imageWebResourceTypeLabel(item.webresourcetype) ||
          imageWebResourceExtensionLabel(uniqueName),
        uniqueName,
      });
    }

    url = response["@odata.nextLink"] ?? "";
  }

  return uniqueByWebResourceUniqueName(picks).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listFolderJavaScriptLibraries(
  ctx: CommandContext,
  binding: BindingEntry,
): Promise<WebResourceLibraryPick[]> {
  const root = ctx.core.configuration.resolveLocalPath(binding.relativeLocalPath);
  const files = await collectJavaScriptFiles(ctx.core.files, root);

  return files.map((filePath) => {
    const relative = path.relative(root, filePath).replace(/\\/g, "/");
    const uniqueName = joinRemotePath(binding.remotePath, relative);
    return {
      label: uniqueName,
      description: ctx.core.configuration.getRelativeToWorkspace(filePath),
      uniqueName,
      localPath: filePath,
    };
  });
}

async function collectJavaScriptFiles(files: WorkspaceFilesPort, root: string): Promise<string[]> {
  const discovered: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: Awaited<ReturnType<WorkspaceFilesPort["readDirectory"]>>;
    try {
      entries = await files.readDirectory(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.type === WorkspaceFileType.Directory) {
        if (entry.name !== "node_modules") {
          await visit(fullPath);
        }
      } else if (entry.type === WorkspaceFileType.File && entry.name.endsWith(".js")) {
        discovered.push(fullPath);
      }
    }
  }

  await visit(root);
  return discovered.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export async function pickJavaScriptFunctionName(
  files: WorkspaceFilesPort,
  library: WebResourceLibraryPick,
  currentFunctionName?: string,
): Promise<string | undefined> {
  const suggestions = withDefaultJavaScriptFunctionSuggestions(
    await listJavaScriptFunctionSuggestions(files, library.localPath),
  );
  if (!suggestions.length) {
    return showRibbonInputBox({
      prompt: "JavaScript function name",
      placeHolder: "validateAndSave",
      value: currentFunctionName ?? "",
      validateInput: (value) => (value.trim() ? undefined : "Function name is required."),
    });
  }

  const manual = "Type function name";
  const suggestionItems = currentFunctionFirst(suggestions, currentFunctionName).map((name) => ({
    label: name,
    description:
      currentFunctionName && isCurrentFunctionSuggestion(name, currentFunctionName)
        ? "Current function"
        : undefined,
  }));
  const pick = await showRibbonQuickPick([...suggestionItems, { label: manual }], {
    placeHolder: "JavaScript function name",
  });
  if (!pick) {
    return undefined;
  }

  if (pick.label !== manual) {
    return pick.label;
  }

  return showRibbonInputBox({
    prompt: "JavaScript function name",
    placeHolder: "validateAndSave",
    value: currentFunctionName ?? "",
    validateInput: (value) => (value.trim() ? undefined : "Function name is required."),
  });
}

async function listJavaScriptFunctionSuggestions(
  files: WorkspaceFilesPort,
  localPath: string | undefined,
): Promise<string[]> {
  if (!localPath) {
    return [];
  }

  const stat = await files.stat(localPath).then(
    (value) => value,
    () => undefined,
  );
  if (!stat || stat.size > 256 * 1024) {
    return [];
  }

  const bytes = await files.readFile(localPath);
  const source = Buffer.from(bytes).toString("utf8");
  return extractJavaScriptFunctionSuggestions(source);
}

export function extractJavaScriptFunctionSuggestions(source: string): string[] {
  const names = new Set<string>();
  const namespaceAliases = getCompiledNamespaceAliases(source);
  const exportedAliases = getCompiledExportedAliases(source, namespaceAliases);
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:^|[;\n]\s*)([A-Za-z_$][\w$]*)\s*=\s*function\s*\(/g,
    /(?:^|[;\n]\s*)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*=\s*function\s*\(/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (isCompiledClassConstructor(source, name)) {
        continue;
      }
      names.add(expandCompiledFunctionName(name, namespaceAliases, exportedAliases));
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function getCompiledNamespaceAliases(source: string): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const match of source.matchAll(
    /\}\)\(\s*([A-Za-z_$][\w$]*)\s*\|\|\s*\(\s*\1\s*=\s*\{\}\s*\)\s*\)/g,
  )) {
    aliases.set(match[1], match[1]);
  }

  for (const match of source.matchAll(
    /\}\)\(\s*([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\|\|/g,
  )) {
    aliases.set(match[1], match[2]);
  }

  return aliases;
}

function getCompiledExportedAliases(
  source: string,
  namespaceAliases: Map<string, string>,
): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const match of source.matchAll(
    /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g,
  )) {
    const namespaceName = expandCompiledNamespaceName(match[1], namespaceAliases);
    if (!namespaceName) {
      continue;
    }
    aliases.set(match[3], `${namespaceName}.${match[2]}`);
  }

  return aliases;
}

function expandCompiledFunctionName(
  name: string,
  namespaceAliases: Map<string, string>,
  exportedAliases: Map<string, string>,
): string {
  const parts = name.split(".");
  const firstPart = parts[0];
  const alias = exportedAliases.get(firstPart) ?? namespaceAliases.get(firstPart);
  return alias ? [alias, ...parts.slice(1)].join(".") : name;
}

function expandCompiledNamespaceName(
  name: string,
  namespaceAliases: Map<string, string>,
): string | undefined {
  const parts = name.split(".");
  const alias = namespaceAliases.get(parts[0]);
  return alias ? [alias, ...parts.slice(1)].join(".") : undefined;
}

function isCompiledClassConstructor(source: string, name: string): boolean {
  return new RegExp(
    `\\bvar\\s+${escapeRegExp(name)}\\s*=\\s*(?:/\\*\\*[\\s\\S]*?\\*/\\s*)?\\(function\\s*\\(\\)\\s*\\{[\\s\\S]{0,512}?\\bfunction\\s+${escapeRegExp(name)}\\s*\\(`,
  ).test(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function currentWebResourceFirst(
  picks: WebResourceLibraryPick[],
  currentUniqueName: string | undefined,
): WebResourceLibraryPick[] {
  const normalized = normalizeWebResourceUniqueName(currentUniqueName ?? "");
  if (!normalized) {
    return picks;
  }

  const currentIndex = picks.findIndex(
    (pick) =>
      normalizeWebResourceUniqueName(pick.uniqueName).toLowerCase() === normalized.toLowerCase(),
  );
  if (currentIndex < 0) {
    return [
      {
        label: normalized,
        description: "Current web resource",
        uniqueName: normalized,
      },
      ...picks,
    ];
  }

  const currentPick = {
    ...picks[currentIndex],
    description: picks[currentIndex].description
      ? `${picks[currentIndex].description} - Current web resource`
      : "Current web resource",
  };
  return [currentPick, ...picks.slice(0, currentIndex), ...picks.slice(currentIndex + 1)];
}
