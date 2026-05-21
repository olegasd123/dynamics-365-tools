import assert from "node:assert";
import test from "node:test";
import { normalizeWebResourceUniqueName } from "../commands/ribbonExplorerCommands";

test("normalizes manually typed web resource names", () => {
  assert.strictEqual(
    normalizeWebResourceUniqueName("  $webresource:new_\\scripts\\account.js  "),
    "new_/scripts/account.js",
  );
  assert.strictEqual(
    normalizeWebResourceUniqueName("new_/scripts/account.js"),
    "new_/scripts/account.js",
  );
});
