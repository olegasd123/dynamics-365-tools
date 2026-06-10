import assert from "node:assert";
import test from "node:test";
import { RibbonView } from "../models";
import { buildRibbonPreview } from "../ribbonPreview";

const range = { start: 0, end: 1 };

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

test("groups buttons by location and sorts them by sequence", () => {
  const location = "Mscrm.Form.account.MainTab.Save.Controls._children";
  const view = viewWith({
    customActions: [
      {
        id: "ca.beta",
        location,
        sequence: 20,
        commandUI: {
          kind: "Button",
          id: "btn.beta",
          command: "new.cmd.beta",
          labelText: "Beta",
          range,
        },
        range,
      },
      {
        id: "ca.alpha",
        location,
        sequence: 10,
        commandUI: {
          kind: "Button",
          id: "btn.alpha",
          command: "new.cmd.alpha",
          labelLocId: "$LocLabels:alpha",
          range,
        },
        range,
      },
    ],
    locLabels: [
      {
        id: "$LocLabels:alpha",
        titles: [{ languageCode: 1033, description: "Alpha", range }],
        range,
      },
    ],
  });

  const model = buildRibbonPreview(view);

  assert.strictEqual(model.isEmpty, false);
  assert.strictEqual(model.locations.length, 1);
  const [group] = model.locations;
  assert.strictEqual(group.label, "MainTab › Save");
  assert.deepStrictEqual(
    group.items.map((item) => item.label),
    ["Alpha", "Beta"],
  );
  assert.strictEqual(group.items[0].commandId, "new.cmd.alpha");
});

test("prefers explicit label text over a localized label", () => {
  const view = viewWith({
    customActions: [
      {
        id: "ca",
        location: "loc",
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

  const [group] = buildRibbonPreview(view).locations;
  assert.strictEqual(group.items[0].label, "Inline");
});

test("includes hidden out-of-the-box buttons", () => {
  const view = viewWith({
    hideActions: [{ hideActionId: "Mscrm.Form.account.Save", location: "loc", range }],
  });

  const model = buildRibbonPreview(view);
  assert.strictEqual(model.isEmpty, false);
  assert.deepStrictEqual(
    model.locations[0].hidden.map((item) => item.id),
    ["Mscrm.Form.account.Save"],
  );
});

test("reports an empty model when the view has no actions", () => {
  const model = buildRibbonPreview(viewWith({}));
  assert.strictEqual(model.isEmpty, true);
  assert.strictEqual(model.locations.length, 0);
});

test("falls back to the command id when no label is available", () => {
  const view = viewWith({
    customActions: [
      {
        id: "ca",
        location: "loc",
        commandUI: { kind: "Button", id: "btn", command: "new.cmd", range },
        range,
      },
    ],
  });

  const [group] = buildRibbonPreview(view).locations;
  assert.strictEqual(group.items[0].label, "new.cmd");
});
