import * as path from "node:path";

const DEFAULT_JAVASCRIPT_FUNCTION_SUGGESTIONS = ["isNaN"];
const IMAGE_WEB_RESOURCE_EXTENSIONS = [".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg"];

export function buildImageWebResourceQueryUrl(searchText?: string): string | undefined {
  const search = searchText?.trim();
  if (search !== undefined && search.length < 2) {
    return undefined;
  }

  const filter = search
    ? `&$filter=${encodeURIComponent(`contains(name,'${escapeODataString(search)}')`)}`
    : "";
  return `/webresourceset?$select=name,displayname,webresourcetype${filter}&$orderby=name asc`;
}

export function isImageWebResourceName(uniqueName: string): boolean {
  const extension = path.posix.extname(uniqueName.toLowerCase());
  return IMAGE_WEB_RESOURCE_EXTENSIONS.includes(extension);
}

export function imageWebResourceTypeLabel(type: number | undefined): string | undefined {
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

export function imageWebResourceExtensionLabel(uniqueName: string): string | undefined {
  const extension = path.posix.extname(uniqueName).replace(/^\./, "");
  return extension ? extension.toUpperCase() : undefined;
}

export function uniqueByWebResourceUniqueName<T extends { uniqueName: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

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

export function normalizeWebResourceUniqueName(value: string): string {
  return value
    .trim()
    .replace(/^\$webresource:/i, "")
    .replace(/\\/g, "/");
}

export function withDefaultJavaScriptFunctionSuggestions(suggestions: string[]): string[] {
  const names = new Set<string>();

  for (const name of DEFAULT_JAVASCRIPT_FUNCTION_SUGGESTIONS) {
    names.add(name);
  }
  for (const name of suggestions) {
    names.add(name);
  }

  return [...names];
}

export function currentFunctionFirst(
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

export function isCurrentFunctionSuggestion(
  suggestion: string,
  currentFunctionName: string,
): boolean {
  const suggestionKey = suggestion.toLowerCase();
  const currentKey = currentFunctionName.trim().toLowerCase();
  return suggestionKey === currentKey || suggestionKey.endsWith(`.${currentKey}`);
}

export function joinRemotePath(root: string, relative: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${relative.replace(/^[\\/]+/, "")}`.replace(/\\/g, "/");
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}
