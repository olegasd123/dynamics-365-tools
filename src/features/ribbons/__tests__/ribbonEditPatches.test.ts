import assert from "node:assert";
import test from "node:test";
import { applyRibbonPatchSequence } from "../ribbonPatchWriter";
import { readRibbonDocuments } from "../ribbonXmlReader";
import {
  createCustomButtonPatches,
  createDeleteNodePatch,
  createHideActionPatches,
} from "../ribbonEditPatches";

test("creates a custom button with command action and label", () => {
  const source = `<RibbonDiffXml>
  <Templates />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  const updated = applyRibbonPatchSequence(
    source,
    createCustomButtonPatches(document, {
      customActionId: "d365tools.account.Form.Validate.CustomAction",
      location: "Mscrm.Form.account.MainTab.Save.Controls._children",
      sequence: 10,
      buttonId: "d365tools.account.Form.Validate.Button",
      commandId: "d365tools.account.Form.Validate.Command",
      labelLocId: "d365tools.account.Form.Validate.Label",
      image16x16: "new_/icons/save16.png",
      image32x32: "new_/icons/save32.png",
      action: {
        kind: "JavaScriptFunction",
        library: "new_/scripts/account.js",
        functionName: "validateAndSave",
      },
      locLabel: {
        id: "d365tools.account.Form.Validate.Label",
        languageCode: 1033,
        description: "Validate and save",
      },
    }),
  );
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const form = updatedDocument.views[0];

  assert.match(updated, /<CustomActions>/);
  assert.match(updated, /<CommandDefinitions>/);
  assert.match(updated, /<LocLabels>/);
  assert.strictEqual(form.customActions[0].commandUI?.kind, "Button");
  assert.strictEqual(form.commandDefinitions[0].actions[0].kind, "JavaScriptFunction");
  assert.strictEqual(form.locLabels[0].titles[0].description, "Validate and save");
  assert.match(updated, /Library="\$webresource:new_\/scripts\/account\.js"/);
});

test("adds a custom button to existing self-closing sections", () => {
  const source = `<RibbonDiffXml>
  <CustomActions />
  <CommandDefinitions />
  <LocLabels />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  const updated = applyRibbonPatchSequence(
    source,
    createCustomButtonPatches(document, {
      customActionId: "d365tools.account.Form.Open.CustomAction",
      location: "Mscrm.Form.account.MainTab.Record.Controls._children",
      buttonId: "d365tools.account.Form.Open.Button",
      commandId: "d365tools.account.Form.Open.Command",
      labelText: "Open help",
      action: {
        kind: "Url",
        address: "https://contoso.example/help",
      },
    }),
  );

  assert.doesNotMatch(updated, /<CustomActions \/>/);
  assert.doesNotMatch(updated, /<CommandDefinitions \/>/);
  assert.match(updated, /<Url Address="https:\/\/contoso\.example\/help" \/>/);
});

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
