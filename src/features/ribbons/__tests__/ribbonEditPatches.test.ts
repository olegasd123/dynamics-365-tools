import assert from "node:assert";
import test from "node:test";
import { applyRibbonPatchSequence } from "../ribbonPatchWriter";
import { readRibbonDocuments } from "../ribbonXmlReader";
import { createDeleteNodePatch, createHideActionPatches } from "../ribbonEditPatches";

test("creates a hide action inside an existing CustomActions section", () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.button" Location="Mscrm.Form.account.MainTab.Save.Controls._children" />
  </CustomActions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  const updated = applyRibbonPatchSequence(
    source,
    createHideActionPatches(document, {
      hideActionId: "d365tools.account.Form.Hide.Mscrm.SavePrimary",
      location: "Mscrm.Form.account.MainTab.Save.Controls._children",
    }),
  );

  assert.match(
    updated,
    /<HideCustomAction HideActionId="d365tools\.account\.Form\.Hide\.Mscrm\.SavePrimary"/,
  );
  assert.match(updated, /Location="Mscrm\.Form\.account\.MainTab\.Save\.Controls\._children"/);
});

test("creates a CustomActions section when a ribbon has none", () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  const updated = applyRibbonPatchSequence(
    source,
    createHideActionPatches(document, {
      hideActionId: "d365tools.account.Form.Hide.Mscrm.SavePrimary",
      location: "Mscrm.Form.account.MainTab.Save.Controls._children",
    }),
  );

  assert.match(updated, /<CustomActions>\n {4}<HideCustomAction/);
  assert.match(updated, /<\/CustomActions>/);
  assert.match(updated, /<CommandDefinitions \/>/);
});

test("delete node patch removes the full XML line", () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <HideCustomAction HideActionId="old" Location="loc" />
  </CustomActions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const hideAction = document.views[0].hideActions[0];

  const updated = applyRibbonPatchSequence(source, [
    createDeleteNodePatch(document.sourceText, hideAction.range),
  ]);

  assert.doesNotMatch(updated, /HideCustomAction/);
  assert.match(updated, /<CustomActions>\n {2}<\/CustomActions>/);
});
