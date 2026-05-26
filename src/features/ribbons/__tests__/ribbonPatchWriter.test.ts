import assert from "node:assert";
import test from "node:test";
import { applyRibbonPatches, hasRibbonChanges } from "../ribbonPatchWriter";

test("no-op patches keep the same text", () => {
  const source = "<RibbonDiffXml><CustomActions /></RibbonDiffXml>";

  assert.strictEqual(applyRibbonPatches(source, []), source);
  assert.strictEqual(hasRibbonChanges(source, []), false);
});

test("applies insert, replace, and delete patches from the end of the file", () => {
  const source = "<root><a>old</a><b /><c>remove</c></root>";
  const result = applyRibbonPatches(source, [
    {
      kind: "replace",
      range: { start: source.indexOf("old"), end: source.indexOf("old") + 3 },
      text: "new",
    },
    { kind: "insert", offset: source.indexOf("<b />") + "<b />".length, text: "<d />" },
    {
      kind: "delete",
      range: { start: source.indexOf("<c>"), end: source.indexOf("</c>") + "</c>".length },
    },
  ]);

  assert.strictEqual(result, "<root><a>new</a><b /><d /></root>");
});

test("rejects overlapping patches", () => {
  assert.throws(
    () =>
      applyRibbonPatches("abcdef", [
        { kind: "replace", range: { start: 1, end: 4 }, text: "x" },
        { kind: "delete", range: { start: 3, end: 5 } },
      ]),
    /overlap/i,
  );
});

test("validates patch ranges", () => {
  assert.throws(
    () => applyRibbonPatches("abc", [{ kind: "delete", range: { start: 1, end: 5 } }]),
    /Invalid ribbon patch range/,
  );
});
