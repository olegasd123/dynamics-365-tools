import assert from "node:assert";
import test from "node:test";
import { applyRibbonPatchSequence } from "../ribbonPatchWriter";
import { readRibbonDocuments } from "../ribbonXmlReader";
import {
  createCommandDefinitionPatches,
  createCommandActionPatch,
  createCommandRuleRefPatch,
  createCustomButtonPatches,
  createDeleteNodePatch,
  createDisplayRulePatches,
  createEnableRulePatches,
  createHideActionPatches,
  createLocLabelPatches,
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

test("creates a standalone command definition", () => {
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
    createCommandDefinitionPatches(document, {
      id: "d365tools.account.Form.Validate.Command",
      action: {
        kind: "JavaScriptFunction",
        library: "new_/scripts/account.js",
        functionName: "validateAndSave",
      },
    }),
  );
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  assert.strictEqual(
    updatedDocument.views[0].commandDefinitions[0].id,
    "d365tools.account.Form.Validate.Command",
  );
  assert.match(updated, /<JavaScriptFunction Library="\$webresource:new_\/scripts\/account\.js"/);
});

test("adds an action to an existing command definition", () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="d365tools.account.Form.Validate.Command">
      <EnableRules />
      <DisplayRules />
      <Actions />
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  const updated = applyRibbonPatchSequence(source, [
    createCommandActionPatch(document, document.views[0].commandDefinitions[0], {
      kind: "JavaScriptFunction",
      library: "new_/scripts/account.js",
      functionName: "validateAndSave",
    }),
  ]);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  assert.strictEqual(updatedDocument.views[0].commandDefinitions[0].actions.length, 1);
  assert.match(updated, /<EnableRules \/>/);
  assert.match(updated, /<DisplayRules \/>/);
  assert.match(updated, /FunctionName="validateAndSave"/);
});

test("adds rule references to command definitions", () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="d365tools.account.Form.Validate.Command" />
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const withEnableRef = applyRibbonPatchSequence(source, [
    createCommandRuleRefPatch(
      document,
      document.views[0].commandDefinitions[0],
      "EnableRule",
      "d365tools.account.Form.EnableRule",
    ),
  ]);
  const [documentWithEnableRef] = readRibbonDocuments(withEnableRef, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const withDisplayRef = applyRibbonPatchSequence(withEnableRef, [
    createCommandRuleRefPatch(
      documentWithEnableRef,
      documentWithEnableRef.views[0].commandDefinitions[0],
      "DisplayRule",
      "d365tools.account.Form.DisplayRule",
    ),
  ]);
  const [updatedDocument] = readRibbonDocuments(withDisplayRef, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const command = updatedDocument.views[0].commandDefinitions[0];

  assert.deepStrictEqual(command.enableRuleRefs, ["d365tools.account.Form.EnableRule"]);
  assert.deepStrictEqual(command.displayRuleRefs, ["d365tools.account.Form.DisplayRule"]);
  assert.match(withDisplayRef, /<EnableRules>\n {8}<EnableRule/);
  assert.match(withDisplayRef, /<DisplayRules>\n {8}<DisplayRule/);
});

test("creates rule definitions and appends simple rules", () => {
  const source = `<RibbonDiffXml>
  <Templates />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  const withEnableRule = applyRibbonPatchSequence(
    source,
    createEnableRulePatches(document, {
      id: "d365tools.account.Form.EnableRule",
      step: {
        kind: "CommandClientTypeRule",
        type: "Modern",
      },
    }),
  );
  const [documentWithEnableRule] = readRibbonDocuments(withEnableRule, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const withDisplayRule = applyRibbonPatchSequence(
    withEnableRule,
    createDisplayRulePatches(documentWithEnableRule, {
      id: "d365tools.account.Form.DisplayRule",
      step: {
        kind: "ValueRule",
        field: "statuscode",
        value: "1",
      },
    }),
  );
  const [updatedDocument] = readRibbonDocuments(withDisplayRule, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  assert.strictEqual(
    updatedDocument.views[0].enableRules[0].steps[0].kind,
    "CommandClientTypeRule",
  );
  assert.strictEqual(updatedDocument.views[0].displayRules[0].steps[0].kind, "ValueRule");
  assert.match(withDisplayRule, /<RuleDefinitions>/);
  assert.match(withDisplayRule, /<EnableRules>/);
  assert.match(withDisplayRule, /<DisplayRules>/);
});

test("creates a loc label section when needed", () => {
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
    createLocLabelPatches(document, {
      id: "d365tools.account.Form.Validate.Label",
      languageCode: 1033,
      description: "Validate and save",
    }),
  );
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  assert.strictEqual(
    updatedDocument.views[0].locLabels[0].titles[0].description,
    "Validate and save",
  );
  assert.match(updated, /<LocLabels>/);
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
