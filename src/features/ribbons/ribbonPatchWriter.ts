import { RibbonPatch, TextRange } from "./models";

export function applyRibbonPatches(sourceText: string, patches: RibbonPatch[]): string {
  if (!patches.length) {
    return sourceText;
  }

  const orderedPatches = patches
    .slice()
    .sort((a, b) => patchStart(b) - patchStart(a) || patchRange(b).end - patchRange(a).end);
  let result = sourceText;
  let previousStart = sourceText.length + 1;

  for (const patch of orderedPatches) {
    const range = patchRange(patch);
    validateRange(range, result.length);

    if (range.end > previousStart) {
      throw new Error("Ribbon patches overlap or are not independent.");
    }

    result = result.slice(0, range.start) + patchText(patch) + result.slice(range.end);
    previousStart = range.start;
  }

  return result;
}

export function hasRibbonChanges(sourceText: string, patches: RibbonPatch[]): boolean {
  return applyRibbonPatches(sourceText, patches) !== sourceText;
}

export function applyRibbonPatchSequence(sourceText: string, patches: RibbonPatch[]): string {
  let result = sourceText;

  for (const patch of patches) {
    const range = patchRange(patch);
    validateRange(range, result.length);
    result = result.slice(0, range.start) + patchText(patch) + result.slice(range.end);
  }

  return result;
}

function patchStart(patch: RibbonPatch): number {
  return patch.kind === "insert" ? patch.offset : patch.range.start;
}

function patchRange(patch: RibbonPatch): TextRange {
  if (patch.kind === "insert") {
    return { start: patch.offset, end: patch.offset };
  }

  return patch.range;
}

function patchText(patch: RibbonPatch): string {
  if (patch.kind === "delete") {
    return "";
  }

  return patch.text;
}

function validateRange(range: TextRange, textLength: number): void {
  if (range.start < 0 || range.end < range.start || range.end > textLength) {
    throw new Error(`Invalid ribbon patch range ${range.start}-${range.end}.`);
  }
}
