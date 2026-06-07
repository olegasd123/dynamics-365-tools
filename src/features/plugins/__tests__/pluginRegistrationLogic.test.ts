import assert from "node:assert";
import test from "node:test";
import {
  asTooltipString,
  buildFilteringAttributePickItems,
  buildMessageNamePickItems,
  buildModePickItems,
  buildPrimaryEntityPickItems,
  buildStagePickItems,
  buildStepDefaultName,
  getDefaultMessagePropertyName,
  getImageTypeOptions,
  parseFilteringAttributes,
} from "../commands/pluginRegistrationLogic";
import type { PluginStep } from "../models";

test("buildStepDefaultName uses the selected entity or global fallback", () => {
  assert.strictEqual(
    buildStepDefaultName("Contoso.Plugin", "Update", "account"),
    "Contoso.Plugin: Update of account",
  );
  assert.strictEqual(
    buildStepDefaultName("Contoso.Plugin", "Create", undefined),
    "Contoso.Plugin: Create of global",
  );
});

test("buildMessageNamePickItems deduplicates names and preserves missing current value", () => {
  assert.deepStrictEqual(buildMessageNamePickItems(["Update", "Create", "Update"], "Delete"), [
    {
      label: "Enter custom message name...",
      description: "Type a message name manually",
      isCustom: true,
    },
    { label: "Delete", description: "Current value", picked: true },
    { label: "Update", picked: false },
    { label: "Create", picked: false },
  ]);
});

test("buildPrimaryEntityPickItems sorts entities and keeps orphan current value", () => {
  assert.deepStrictEqual(buildPrimaryEntityPickItems(["contact", "account", "contact"], "lead"), [
    {
      label: "Global message (no primary entity)",
      description: "Use for messages without a primary entity",
      type: "none",
      picked: false,
    },
    { label: "lead", description: "Current value", type: "entity", picked: true },
    { label: "account", type: "entity", picked: false },
    { label: "contact", type: "entity", picked: false },
    {
      label: "Enter custom logical name...",
      description: "Type a logical name manually",
      type: "custom",
    },
  ]);
});

test("parseFilteringAttributes trims comma-separated values", () => {
  assert.deepStrictEqual(
    [...parseFilteringAttributes(" name, emailaddress1 ,, telephone1 ")],
    ["name", "emailaddress1", "telephone1"],
  );
});

test("buildFilteringAttributePickItems sorts attributes and marks defaults", () => {
  assert.deepStrictEqual(
    buildFilteringAttributePickItems(["emailaddress1", "", "name"], " name "),
    [
      {
        label: "Enter custom list...",
        description: "Type attributes manually",
        pickType: "custom",
      },
      { label: "emailaddress1", pickType: "attribute", picked: false },
      { label: "name", pickType: "attribute", picked: true },
    ],
  );
});

test("buildStagePickItems and buildModePickItems mark default choices", () => {
  assert.strictEqual(buildStagePickItems(20).find((item) => item.value === 20)?.picked, true);
  assert.strictEqual(buildModePickItems(1).find((item) => item.value === 1)?.picked, true);
});

test("getImageTypeOptions limits create and delete messages to valid image types", () => {
  assert.deepStrictEqual(
    getImageTypeOptions(step("Create")).map((item) => item.value),
    [1],
  );
  assert.deepStrictEqual(
    getImageTypeOptions(step("delete")).map((item) => item.value),
    [0],
  );
  assert.deepStrictEqual(
    getImageTypeOptions(step("Update")).map((item) => item.value),
    [0, 1, 2],
  );
});

test("getDefaultMessagePropertyName uses Id only for create messages", () => {
  assert.strictEqual(getDefaultMessagePropertyName(step("CREATE")), "Id");
  assert.strictEqual(getDefaultMessagePropertyName(step("Update")), "Target");
});

test("asTooltipString normalizes string and markdown-like tooltips", () => {
  assert.strictEqual(asTooltipString(" **Plugin Step** "), "Plugin Step");
  assert.strictEqual(asTooltipString({ value: " **Plugin Image** " }), "Plugin Image");
  assert.strictEqual(asTooltipString(" **  ** "), undefined);
});

function step(messageName: string): PluginStep {
  return {
    id: "step-id",
    name: "Step",
    messageName,
  };
}
