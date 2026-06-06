import assert from "node:assert";
import test from "node:test";
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
} from "../commands/ribbonResourcePromptSupport";

test("buildImageWebResourceQueryUrl builds base and escaped search queries", () => {
  assert.strictEqual(
    buildImageWebResourceQueryUrl(),
    "/webresourceset?$select=name,displayname,webresourcetype&$orderby=name asc",
  );
  assert.strictEqual(buildImageWebResourceQueryUrl("x"), undefined);

  const searchUrl = decodeURIComponent(buildImageWebResourceQueryUrl("o'hare") ?? "");
  assert.match(searchUrl, /\$filter=contains\(name,'o''hare'\)/);
  assert.doesNotMatch(searchUrl, /\$top=/);
});

test("image web resource helpers recognize supported image extensions and labels", () => {
  assert.strictEqual(isImageWebResourceName("new_/icons/account.SVG"), true);
  assert.strictEqual(isImageWebResourceName("new_/scripts/account.js"), false);
  assert.strictEqual(imageWebResourceTypeLabel(10), "ICO");
  assert.strictEqual(imageWebResourceTypeLabel(12), undefined);
  assert.strictEqual(imageWebResourceExtensionLabel("new_/icons/account.png"), "PNG");
});

test("uniqueByWebResourceUniqueName de-duplicates normalized names case-insensitively", () => {
  const items = uniqueByWebResourceUniqueName([
    { label: "first", uniqueName: "$webresource:new_\\account\\form.js" },
    { label: "second", uniqueName: "new_/account/form.js" },
    { label: "third", uniqueName: "new_/account/other.js" },
  ]);

  assert.deepStrictEqual(
    items.map((item) => item.label),
    ["first", "third"],
  );
});

test("JavaScript function helpers keep defaults and prefer current function matches", () => {
  assert.deepStrictEqual(withDefaultJavaScriptFunctionSuggestions(["onSave", "isNaN"]), [
    "isNaN",
    "onSave",
  ]);
  assert.deepStrictEqual(currentFunctionFirst(["Namespace.onSave", "onLoad"], "onSave"), [
    "Namespace.onSave",
    "onLoad",
  ]);
  assert.deepStrictEqual(currentFunctionFirst(["onLoad"], "onSave"), ["onSave", "onLoad"]);
  assert.strictEqual(isCurrentFunctionSuggestion("Namespace.onSave", " onSave "), true);
});

test("joinRemotePath and normalizeWebResourceUniqueName normalize CRM path separators", () => {
  assert.strictEqual(
    joinRemotePath("new_\\scripts\\", "\\account/form.js"),
    "new_/scripts/account/form.js",
  );
  assert.strictEqual(
    normalizeWebResourceUniqueName("  $webresource:new_\\scripts\\account.js  "),
    "new_/scripts/account.js",
  );
});
