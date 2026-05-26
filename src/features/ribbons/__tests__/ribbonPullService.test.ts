import assert from "node:assert";
import test from "node:test";
import { applyRibbonPatchSequence } from "../ribbonPatchWriter";
import { createRibbonPullPlan, ribbonPullKey } from "../ribbonPullService";
import { readRibbonDocuments } from "../ribbonXmlReader";

test("plans pull patches for matching application and entity ribbons", () => {
  const localText = `<ImportExportXml>
  <RibbonDiffXml><CustomActions /></RibbonDiffXml>
  <Entities>
    <Entity>
      <Name>account</Name>
      <RibbonDiffXml><CustomActions /></RibbonDiffXml>
    </Entity>
    <Entity>
      <Name>contact</Name>
      <RibbonDiffXml><CustomActions /></RibbonDiffXml>
    </Entity>
  </Entities>
</ImportExportXml>`;
  const incomingText = `<ImportExportXml>
  <RibbonDiffXml><CustomActions><HideCustomAction HideActionId="app.hide" Location="Mscrm.Application" /></CustomActions></RibbonDiffXml>
  <Entities>
    <Entity>
      <Name>account</Name>
      <RibbonDiffXml><CustomActions><HideCustomAction HideActionId="account.hide" Location="Mscrm.Form.account.Save" /></CustomActions></RibbonDiffXml>
    </Entity>
  </Entities>
</ImportExportXml>`;

  const localDocuments = readRibbonDocuments(localText, {
    sourceId: "local",
    fileUri: "/tmp/customizations.xml",
  });
  const incomingDocuments = readRibbonDocuments(incomingText, {
    sourceId: "incoming",
    fileUri: "/tmp/incoming/customizations.xml",
  });

  const plan = createRibbonPullPlan(localDocuments, incomingDocuments);

  assert.deepStrictEqual(plan.matchedDocuments.map(ribbonPullKey), [
    "application",
    "entity:account",
  ]);
  assert.deepStrictEqual(plan.missingDocuments.map(ribbonPullKey), ["entity:contact"]);

  const patches = plan.patchesByFileUri.get("/tmp/customizations.xml") ?? [];
  const updated = applyRibbonPatchSequence(localText, patches);
  assert.match(updated, /HideActionId="app\.hide"/);
  assert.match(updated, /HideActionId="account\.hide"/);
  assert.match(
    updated,
    /<Name>contact<\/Name>\s*<RibbonDiffXml><CustomActions \/><\/RibbonDiffXml>/,
  );
});

test("marks matching ribbons unchanged when XML is the same", () => {
  const text = `<RibbonDiffXml><CustomActions /></RibbonDiffXml>`;
  const [localDocument] = readRibbonDocuments(text, {
    sourceId: "local",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const [incomingDocument] = readRibbonDocuments(text, {
    sourceId: "incoming",
    fileUri: "/tmp/incoming/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  const plan = createRibbonPullPlan([localDocument], [incomingDocument]);

  assert.strictEqual(plan.matchedDocuments.length, 0);
  assert.strictEqual(plan.unchangedDocuments.length, 1);
  assert.strictEqual(plan.patchesByFileUri.size, 0);
});
