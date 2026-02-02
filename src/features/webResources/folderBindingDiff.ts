export interface FolderBindingDiffSummary {
  localCount: number;
  crmCount: number;
  matchCount: number;
  onlyLocalCount: number;
  onlyCrmCount: number;
  hasDifferences: boolean;
}

export function compareFolderBindingResources(
  localRemotePaths: string[],
  crmRemotePaths: string[],
): FolderBindingDiffSummary {
  const localSet = new Set(localRemotePaths.map((item) => normalizeRemotePath(item).toLowerCase()));
  const crmSet = new Set(crmRemotePaths.map((item) => normalizeRemotePath(item).toLowerCase()));

  let matchCount = 0;
  for (const local of localSet) {
    if (crmSet.has(local)) {
      matchCount += 1;
    }
  }

  const onlyLocalCount = localSet.size - matchCount;
  const onlyCrmCount = crmSet.size - matchCount;

  return {
    localCount: localSet.size,
    crmCount: crmSet.size,
    matchCount,
    onlyLocalCount,
    onlyCrmCount,
    hasDifferences: onlyLocalCount > 0 || onlyCrmCount > 0,
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
