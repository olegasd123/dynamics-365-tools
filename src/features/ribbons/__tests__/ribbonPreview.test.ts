import assert from "node:assert";
import test from "node:test";
import { RibbonView } from "../models";
import { buildRibbonPreview, RibbonPreviewGroup } from "../ribbonPreview";

const range = { start: 0, end: 1 };
const recordLocation = "Mscrm.Form.account.MainTab.Record.Controls._children";

function viewWith(overrides: Partial<RibbonView>): RibbonView {
  return {
    scope: "Form",
    customActions: [],
    hideActions: [],
    commandDefinitions: [],
    enableRules: [],
    displayRules: [],
    locLabels: [],
    unknownNodeRanges: [],
    ...overrides,
  };
}

function groupByLabel(groups: RibbonPreviewGroup[], label: string): RibbonPreviewGroup {
  const group = groups.find((entry) => entry.label === label);
  assert.ok(group, `expected a "${label}" group`);
  return group;
}

test("renders the standard command bar even without customizations", () => {
  const model = buildRibbonPreview(viewWith({}), "account");

  assert.strictEqual(model.isEmpty, false);
  assert.strictEqual(model.hasCustomizations, false);
  assert.strictEqual(model.tabLabel, "Mscrm.Form.account.MainTab");
  const record = groupByLabel(model.groups, "Record");
  assert.ok(record.items.every((item) => item.source === "oob"));
  assert.ok(record.items.some((item) => item.label === "Delete"));
});

test("slots a custom button into the matching group by sequence", () => {
  const view = viewWith({
    customActions: [
      {
        id: "ca.approve",
        location: recordLocation,
        sequence: 35,
        commandUI: {
          kind: "Button",
          id: "btn.approve",
          command: "new.cmd.approve",
          labelText: "Approve",
          range,
        },
        range,
      },
    ],
  });

  const model = buildRibbonPreview(view, "account");
  const record = groupByLabel(model.groups, "Record");
  const labels = record.items.map((item) => item.label);
  const approveIndex = labels.indexOf("Approve");

  assert.strictEqual(model.hasCustomizations, true);
  assert.ok(approveIndex > labels.indexOf("New"), "custom button sits after the New button");
  assert.ok(approveIndex < labels.indexOf("Delete"), "custom button sits before the Delete button");
  assert.strictEqual(record.items[approveIndex].source, "custom");
});

test("marks a hidden out-of-the-box button", () => {
  const view = viewWith({
    hideActions: [{ hideActionId: "Mscrm.Form.account.Delete", location: recordLocation, range }],
  });

  const model = buildRibbonPreview(view, "account");
  const record = groupByLabel(model.groups, "Record");
  const remove = record.items.find((item) => item.label === "Delete");

  assert.ok(remove);
  assert.strictEqual(remove.hidden, true);
});

test("keeps custom-only locations as their own group", () => {
  const location = "Mscrm.Form.account.MainTab.MyGroup.Controls._children";
  const view = viewWith({
    customActions: [
      {
        id: "ca",
        location,
        commandUI: { kind: "Button", id: "btn", command: "new.cmd", labelText: "Custom", range },
        range,
      },
    ],
  });

  const model = buildRibbonPreview(view, "account");
  const group = groupByLabel(model.groups, "MainTab › MyGroup");

  assert.strictEqual(group.items.length, 1);
  assert.strictEqual(group.items[0].source, "custom");
});

test("prefers explicit label text over a localized label", () => {
  const view = viewWith({
    customActions: [
      {
        id: "ca",
        location: recordLocation,
        commandUI: {
          kind: "Button",
          id: "btn",
          command: "cmd",
          labelText: "Inline",
          labelLocId: "$LocLabels:other",
          range,
        },
        range,
      },
    ],
    locLabels: [
      {
        id: "$LocLabels:other",
        titles: [{ languageCode: 1033, description: "Localized", range }],
        range,
      },
    ],
  });

  const record = groupByLabel(buildRibbonPreview(view, "account").groups, "Record");
  assert.ok(record.items.some((item) => item.source === "custom" && item.label === "Inline"));
});

test("reports an empty model for a command bar with no buttons", () => {
  const model = buildRibbonPreview(viewWith({ scope: "Application" }), "account");

  assert.strictEqual(model.isEmpty, true);
  assert.strictEqual(model.groups.length, 0);
});
