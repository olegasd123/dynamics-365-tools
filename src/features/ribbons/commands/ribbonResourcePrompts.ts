import * as path from "node:path";
import * as vscode from "vscode";
import { CommandContext } from "../../../app/commandContext";
import { pickDataverseClient } from "../../../platform/vscode/commandUtils";
import { BindingEntry } from "../../config/domain/models";
import type { DataverseClient } from "../../dataverse/dataverseClient";
import { showRibbonInputBox, showRibbonQuickPick } from "./ribbonPromptUi";

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

const DEFAULT_JAVASCRIPT_FUNCTION_SUGGESTIONS = ["isNaN"];
const IMAGE_WEB_RESOURCE_EXTENSIONS = [".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg"];

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
  const config = await ctx.configuration.loadConfiguration();
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
  const snapshot = await ctx.bindings.listBindings();
  const picks: WebResourceLibraryPick[] = [];

  for (const binding of snapshot.bindings) {
    if (binding.kind === "file") {
      const uniqueName = binding.remotePath.replace(/\\/g, "/");
      if (uniqueName.toLowerCase().endsWith(".js")) {
        picks.push({
          label: uniqueName,
          description: ctx.configuration.getRelativeToWorkspace(
            ctx.configuration.resolveLocalPath(binding.relativeLocalPath),
          ),
          uniqueName,
          localPath: ctx.configuration.resolveLocalPath(binding.relativeLocalPath),
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
  const search = searchText?.trim();
  if (search !== undefined && search.length < 2) {
    return [];
  }

  const filter = search
    ? `&$filter=${encodeURIComponent(`contains(name,'${escapeODataString(search)}')`)}`
    : "";
  let url = `/webresourceset?$select=name,displayname,webresourcetype${filter}&$orderby=name asc`;
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

function isImageWebResourceName(uniqueName: string): boolean {
  const extension = path.posix.extname(uniqueName.toLowerCase());
  return IMAGE_WEB_RESOURCE_EXTENSIONS.includes(extension);
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listFolderJavaScriptLibraries(
  ctx: CommandContext,
  binding: BindingEntry,
): Promise<WebResourceLibraryPick[]> {
  const root = ctx.configuration.resolveLocalPath(binding.relativeLocalPath);
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(root, "**/*.js"),
    "**/node_modules/**",
  );

  return files.map((file) => {
    const relative = path.relative(root, file.fsPath).replace(/\\/g, "/");
    const uniqueName = joinRemotePath(binding.remotePath, relative);
    return {
      label: uniqueName,
      description: ctx.configuration.getRelativeToWorkspace(file.fsPath),
      uniqueName,
      localPath: file.fsPath,
    };
  });
}

export async function pickJavaScriptFunctionName(
  library: WebResourceLibraryPick,
  currentFunctionName?: string,
): Promise<string | undefined> {
  const suggestions = withDefaultJavaScriptFunctionSuggestions(
    await listJavaScriptFunctionSuggestions(library.localPath),
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

async function listJavaScriptFunctionSuggestions(localPath: string | undefined): Promise<string[]> {
  if (!localPath) {
    return [];
  }

  const stat = await vscode.workspace.fs.stat(vscode.Uri.file(localPath)).then(
    (value) => value,
    () => undefined,
  );
  if (!stat || stat.size > 256 * 1024) {
    return [];
  }

  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(localPath));
  const source = Buffer.from(bytes).toString("utf8");
  return extractJavaScriptFunctionSuggestions(source);
}

function withDefaultJavaScriptFunctionSuggestions(suggestions: string[]): string[] {
  const names = new Set<string>();

  for (const name of DEFAULT_JAVASCRIPT_FUNCTION_SUGGESTIONS) {
    names.add(name);
  }
  for (const name of suggestions) {
    names.add(name);
  }

  return [...names];
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

function uniqueByWebResourceUniqueName(items: WebResourceLibraryPick[]): WebResourceLibraryPick[] {
  const seen = new Set<string>();
  const result: WebResourceLibraryPick[] = [];

  for (const item of items) {
    const key = normalizeWebResourceUniqueName(item.uniqueName).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }

  return result;
}

function imageWebResourceTypeLabel(type: number | undefined): string | undefined {
  switch (type) {
    case 5:
      return "PNG";
    case 6:
      return "JPG";
    case 7:
      return "GIF";
    case 10:
      return "ICO";
    case 11:
      return "SVG";
    default:
      return undefined;
  }
}

function imageWebResourceExtensionLabel(uniqueName: string): string | undefined {
  const extension = path.posix.extname(uniqueName).replace(/^\./, "");
  return extension ? extension.toUpperCase() : undefined;
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

function currentFunctionFirst(
  suggestions: string[],
  currentFunctionName: string | undefined,
): string[] {
  const current = currentFunctionName?.trim();
  if (!current) {
    return suggestions;
  }

  const currentIndex = suggestions.findIndex(
    (name) => name.toLowerCase() === current.toLowerCase(),
  );
  const suffixIndex = suggestions.findIndex((name) => isCurrentFunctionSuggestion(name, current));
  const bestIndex = currentIndex >= 0 ? currentIndex : suffixIndex;
  if (bestIndex < 0) {
    return [current, ...suggestions];
  }

  return [
    suggestions[bestIndex],
    ...suggestions.slice(0, bestIndex),
    ...suggestions.slice(bestIndex + 1),
  ];
}

function isCurrentFunctionSuggestion(suggestion: string, currentFunctionName: string): boolean {
  const suggestionKey = suggestion.toLowerCase();
  const currentKey = currentFunctionName.trim().toLowerCase();
  return suggestionKey === currentKey || suggestionKey.endsWith(`.${currentKey}`);
}

function joinRemotePath(root: string, relative: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${relative.replace(/^[\\/]+/, "")}`.replace(/\\/g, "/");
}

export function normalizeWebResourceUniqueName(value: string): string {
  return value
    .trim()
    .replace(/^\$webresource:/i, "")
    .replace(/\\/g, "/");
}
