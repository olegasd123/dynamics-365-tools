import assert from "node:assert";
import test from "node:test";
import { applyRibbonPatchSequence } from "../ribbonPatchWriter";

test("no-op patches keep the same text", () => {
  const source = "<RibbonDiffXml><CustomActions /></RibbonDiffXml>";

  assert.strictEqual(applyRibbonPatchSequence(source, []), source);
});

test("applies insert, replace, and delete patches in sequence", () => {
  const source = "<root><a>old</a><b /><c>remove</c></root>";
  const result = applyRibbonPatchSequence(source, [
    {
      kind: "delete",
      range: { start: source.indexOf("<c>"), end: source.indexOf("</c>") + "</c>".length },
    },
    { kind: "insert", offset: source.indexOf("<b />") + "<b />".length, text: "<d />" },
    {
      kind: "replace",
      range: { start: source.indexOf("old"), end: source.indexOf("old") + 3 },
      text: "new",
    },
  ]);

  assert.strictEqual(result, "<root><a>new</a><b /><d /></root>");
});

test("validates patch ranges", () => {
  assert.throws(
    () => applyRibbonPatchSequence("abc", [{ kind: "delete", range: { start: 1, end: 5 } }]),
    /Invalid ribbon patch range/,
  );
});
