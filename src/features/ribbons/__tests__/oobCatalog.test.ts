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

test("lists parameterized OOB commands by ribbon scope", () => {
  const formCommands = listOobRibbonCommands("Form", "account");
  const gridCommands = listOobRibbonCommands("HomepageGrid", "account");

  assert.ok(formCommands.some((command) => command.id === "Mscrm.SavePrimary"));
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
});
