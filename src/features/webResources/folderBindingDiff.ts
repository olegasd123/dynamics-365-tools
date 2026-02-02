export interface FolderBindingDiffSummary {
  localCount: number;
  crmCount: number;
  matchCount: number;
  onlyLocalCount: number;
  onlyCrmCount: number;
  onlyLocal: string[];
  onlyCrm: string[];
  hasDifferences: boolean;
}

export function compareFolderBindingResources(
  localRemotePaths: string[],
  crmRemotePaths: string[],
): FolderBindingDiffSummary {
  const localMap = buildPathMap(localRemotePaths);
  const crmMap = buildPathMap(crmRemotePaths);
  const localSet = new Set(localMap.keys());
  const crmSet = new Set(crmMap.keys());

  let matchCount = 0;
  for (const local of localSet) {
    if (crmSet.has(local)) {
      matchCount += 1;
    }
  }

  const onlyLocal = [...localSet]
    .filter((item) => !crmSet.has(item))
    .map((item) => localMap.get(item) || item)
    .sort();
  const onlyCrm = [...crmSet]
    .filter((item) => !localSet.has(item))
    .map((item) => crmMap.get(item) || item)
    .sort();

  return {
    localCount: localSet.size,
    crmCount: crmSet.size,
    matchCount,
    onlyLocalCount: onlyLocal.length,
    onlyCrmCount: onlyCrm.length,
    onlyLocal,
    onlyCrm,
    hasDifferences: onlyLocal.length > 0 || onlyCrm.length > 0,
  };
}

export function normalizeRemotePath(remotePath: string): string {
  return remotePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function buildPathMap(paths: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of paths) {
    const normalized = normalizeRemotePath(raw);
    map.set(normalized.toLowerCase(), normalized);
  }
  return map;
}
