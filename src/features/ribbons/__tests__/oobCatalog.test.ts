import assert from "node:assert";
import test from "node:test";
import {
  findOobRibbonCommand,
  findOobRibbonLocation,
  listOobRibbonCommands,
  listOobRibbonLocations,
} from "../oobCatalog";

test("lists parameterized OOB locations by ribbon scope", () => {
  const locations = listOobRibbonLocations("HomepageGrid", "account");

  assert.ok(locations.length >= 5);
  assert.ok(locations.every((location) => location.scope === "HomepageGrid"));
  assert.ok(
    locations.some(
      (location) =>
        location.id === "homepagegrid-management" &&
        location.location === "Mscrm.HomepageGrid.account.MainTab.Management.Controls._children",
    ),
  );
});

test("lists application ribbon locations", () => {
  const locations = listOobRibbonLocations("Application");

  assert.ok(
    locations.some(
      (location) =>
        location.id === "application-global-new" &&
        location.location === "Mscrm.GlobalTab.New.Controls._children",
    ),
  );
});

test("lists parameterized OOB commands by ribbon scope", () => {
  const formCommands = listOobRibbonCommands("Form", "account");
  const gridCommands = listOobRibbonCommands("HomepageGrid", "account");

  assert.ok(formCommands.some((command) => command.id === "Mscrm.SavePrimary"));
  assert.ok(
    gridCommands.some(
      (command) =>
        command.id === "Mscrm.HomepageGrid.account.NewRecord" &&
        command.commandId === "Mscrm.NewRecordFromGrid" &&
        command.controlId === "Mscrm.HomepageGrid.account.NewRecord",
    ),
  );
  assert.ok(
    gridCommands.some((command) => command.id === "Mscrm.HomepageGrid.account.AddNewRecord"),
  );
  assert.ok(gridCommands.every((command) => command.scopes.includes("HomepageGrid")));
});

test("finds OOB catalog entries after entity substitution", () => {
  assert.strictEqual(
    findOobRibbonLocation("form-save", "contact")?.location,
    "Mscrm.Form.contact.MainTab.Save.Controls._children",
  );
  assert.strictEqual(
    findOobRibbonCommand("Mscrm.SubGrid.contact.Refresh", "contact")?.label,
    "Refresh",
  );
  assert.strictEqual(
    findOobRibbonCommand("Mscrm.AddExistingRecordFromSubGridStandard", "contact")?.controlId,
    "Mscrm.SubGrid.contact.AddExistingStandard",
  );
});

test("merges OOB command ids that are shared by multiple controls", () => {
  const command = findOobRibbonCommand("Mscrm.EditSelectedRecord", "account");

  assert.ok(command);
  assert.deepStrictEqual(command.scopes, ["HomepageGrid", "SubGrid"]);
  assert.deepStrictEqual(command.locationIds, ["homepagegrid-records", "subgrid-actions"]);
  assert.strictEqual(command.controlId, undefined);
  assert.strictEqual(
    findOobRibbonCommand("Mscrm.SubGrid.account.Edit", "account")?.controlId,
    "Mscrm.SubGrid.account.Edit",
  );
});

test("filters OOB command variants by catalog version", () => {
  const modernCommands = listOobRibbonCommands("HomepageGrid", "account", {
    version: "modern",
  });
  const legacyCommands = listOobRibbonCommands("HomepageGrid", "account", {
    version: "legacy",
  });

  assert.ok(
    modernCommands.some((command) => command.id === "Mscrm.HomepageGrid.account.NewRecord"),
  );
  assert.ok(
    !modernCommands.some((command) => command.id === "Mscrm.HomepageGrid.account.AddNewRecord"),
  );
  assert.ok(
    legacyCommands.some((command) => command.id === "Mscrm.HomepageGrid.account.AddNewRecord"),
  );
  assert.ok(
    !legacyCommands.some((command) => command.id === "Mscrm.HomepageGrid.account.NewRecord"),
  );
  assert.strictEqual(
    findOobRibbonCommand("Mscrm.NewRecordFromGrid", "account", { version: "modern" })?.controlId,
    "Mscrm.HomepageGrid.account.NewRecord",
  );
  assert.strictEqual(
    findOobRibbonCommand("Mscrm.NewRecordFromGrid", "account", { version: "legacy" }),
    undefined,
  );
});
