import assert from "node:assert";
import test from "node:test";
import { applyRibbonPatches } from "../ribbonPatchWriter";
import { readRibbonDocuments, scanXmlElements } from "../ribbonXmlReader";

const ribbonXml = `<RibbonDiffXml>
  <CustomActions>
    <!-- keep this comment -->
    <CustomAction Id="new.account.Form.Button.CustomAction" Location="Mscrm.Form.account.MainTab.Save.Controls._children" Sequence="10">
      <CommandUIDefinition>
        <Button Id="new.account.Form.Button" Command="new.account.Validate.Command" LabelText="Validate" Image16by16="$webresource:new_/img/validate16.png" />
      </CommandUIDefinition>
    </CustomAction>
    <HideCustomAction HideActionId="new.account.Form.Hide.Save" Location="Mscrm.Form.account.MainTab.Save.Controls._children" />
  </CustomActions>
  <Templates />
  <CommandDefinitions>
    <CommandDefinition Id="new.account.Validate.Command">
      <EnableRules>
        <EnableRule Id="new.account.Enable" />
      </EnableRules>
      <DisplayRules>
        <DisplayRule Id="new.account.Display" />
      </DisplayRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:new_/scripts/account.js" FunctionName="validate">
          <StringParameter Value="beforeSave" />
        </JavaScriptFunction>
        <Url Address="https://example.com" />
        <UnknownAction Foo="Bar" />
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions>
    <TabDisplayRules />
    <DisplayRules>
      <DisplayRule Id="new.account.Display">
        <EntityPrivilegeRule EntityName="account" PrivilegeType="Write" PrivilegeDepth="Basic" />
      </DisplayRule>
    </DisplayRules>
    <EnableRules>
      <EnableRule Id="new.account.Enable">
        <CustomRule Library="$webresource:new_/scripts/account.js" FunctionName="canValidate" Default="true" />
        <CommandClientTypeRule Type="Modern" />
      </EnableRule>
    </EnableRules>
  </RuleDefinitions>
  <LocLabels>
    <LocLabel Id="new.account.Label">
      <Titles>
        <Title languagecode="1033" description="Validate &amp; Save" />
      </Titles>
    </LocLabel>
  </LocLabels>
  <FutureNode><![CDATA[<keep>raw</keep>]]></FutureNode>
</RibbonDiffXml>`;

test("scans XML elements without treating comments or CDATA as nodes", () => {
  const roots = scanXmlElements(ribbonXml);

  assert.strictEqual(roots.length, 1);
  assert.strictEqual(roots[0].name, "RibbonDiffXml");
  assert.ok(roots[0].children.some((child) => child.name === "CustomActions"));
  assert.ok(roots[0].children.some((child) => child.name === "FutureNode"));
});

test("reads major ribbon sections and known nodes with ranges", () => {
  const [document] = readRibbonDocuments(ribbonXml, {
    sourceId: "fixture",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const view = document.views[0];

  assert.strictEqual(document.kind, "Entity");
  assert.strictEqual(document.entityLogicalName, "account");
  assert.deepStrictEqual(Object.keys(document.sections).sort(), [
    "commandDefinitions",
    "customActions",
    "locLabels",
    "ruleDefinitions",
    "templates",
  ]);
  assert.strictEqual(view.scope, "Form");
  assert.strictEqual(view.customActions.length, 1);
  assert.strictEqual(view.customActions[0].id, "new.account.Form.Button.CustomAction");
  assert.strictEqual(view.customActions[0].sequence, 10);
  assert.strictEqual(view.customActions[0].commandUI?.kind, "Button");
  assert.strictEqual(view.hideActions[0].hideActionId, "new.account.Form.Hide.Save");
  assert.strictEqual(view.commandDefinitions[0].enableRuleRefs[0], "new.account.Enable");
  assert.strictEqual(view.commandDefinitions[0].actions[0].kind, "JavaScriptFunction");
  assert.strictEqual(view.enableRules[0].steps[0].kind, "CustomRule");
  assert.strictEqual(view.displayRules[0].steps[0].kind, "EntityPrivilegeRule");
  assert.strictEqual(view.locLabels[0].titles[0].description, "Validate & Save");
  assert.strictEqual(view.unknownNodeRanges.length, 1);
});

test("locates embedded RibbonDiffXml blocks in flat customizations XML", () => {
  const flatXml = `<ImportExportXml>
  <Entities>
    <Entity><Name>account</Name>${ribbonXml}</Entity>
    <Entity><Name>contact</Name><RibbonDiffXml><CustomActions /></RibbonDiffXml></Entity>
  </Entities>
</ImportExportXml>`;

  const documents = readRibbonDocuments(flatXml, {
    sourceId: "flat",
    fileUri: "/tmp/customizations.xml",
  });

  assert.strictEqual(documents.length, 2);
  assert.ok(documents[0].ribbonRange.start > 0);
  assert.strictEqual(documents[1].views[0].customActions.length, 0);
});

test("ranges can drive surgical patches while unknown XML stays byte-identical", () => {
  const [document] = readRibbonDocuments(ribbonXml);
  const action = document.views[0].customActions[0];
  const replacement = ribbonXml
    .slice(action.range.start, action.range.end)
    .replace(`Sequence="10"`, `Sequence="20"`);

  const patched = applyRibbonPatches(ribbonXml, [
    { kind: "replace", range: action.range, text: replacement },
  ]);

  assert.ok(patched.includes(`Sequence="20"`));
  assert.ok(patched.includes(`<!-- keep this comment -->`));
  assert.ok(patched.includes(`<![CDATA[<keep>raw</keep>]]>`));
});
