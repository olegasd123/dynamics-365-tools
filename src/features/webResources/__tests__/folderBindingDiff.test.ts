import assert from "node:assert";
import test from "node:test";
import { compareFolderBindingResources, normalizeRemotePath } from "../folderBindingDiff";

test("normalizeRemotePath keeps CRM path format stable", () => {
  assert.strictEqual(
    normalizeRemotePath("  new_\\folder//sub///file.js "),
    "new_/folder/sub/file.js",
  );
  assert.strictEqual(normalizeRemotePath("/new_/folder/"), "new_/folder");
});

test("compareFolderBindingResources reports matching counts", () => {
  const summary = compareFolderBindingResources(
    ["new_/site/a.js", "new_/site/b.js"],
    ["new_/site/a.js", "new_/site/c.js"],
  );

  assert.strictEqual(summary.localCount, 2);
  assert.strictEqual(summary.crmCount, 2);
  assert.strictEqual(summary.matchCount, 1);
  assert.strictEqual(summary.onlyLocalCount, 1);
  assert.strictEqual(summary.onlyCrmCount, 1);
  assert.strictEqual(summary.hasDifferences, true);
});

test("compareFolderBindingResources ignores duplicates and path casing", () => {
  const summary = compareFolderBindingResources(
    ["new_/site/A.js", "new_\\site\\A.js", "new_/site/b.js"],
    ["new_/site/a.js", "new_/site/B.js"],
  );

  assert.strictEqual(summary.localCount, 2);
  assert.strictEqual(summary.crmCount, 2);
  assert.strictEqual(summary.matchCount, 2);
  assert.strictEqual(summary.onlyLocalCount, 0);
  assert.strictEqual(summary.onlyCrmCount, 0);
  assert.strictEqual(summary.hasDifferences, false);
});
