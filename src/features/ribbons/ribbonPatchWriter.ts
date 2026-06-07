import { RibbonPatch, TextRange } from "./models";

export function applyRibbonPatchSequence(sourceText: string, patches: RibbonPatch[]): string {
  let result = sourceText;

  for (const patch of patches) {
    const range = patchRange(patch);
    validateRange(range, result.length);
    result = result.slice(0, range.start) + patchText(patch) + result.slice(range.end);
  }

  return result;
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
