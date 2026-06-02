import assert from "node:assert";
import test from "node:test";
import { applyRibbonPatches } from "../ribbonPatchWriter";
import { readRibbonDocuments, scanXmlElements } from "../ribbonXmlReader";

const ribbonXml = `<RibbonDiffXml>
  <CustomActions>
    <!-- keep this comment -->
    <CustomAction Id="new.account.Form.Button.CustomAction" Location="Mscrm.Form.account.MainTab.Save.Controls._children" Sequence="10">
      <CommandUIDefinition>
        <Button Id="new.account.Form.Button" Command="new.account.Validate.Command" LabelText="Validate" Alt="Validate" ToolTipTitle="Validate" ToolTipDescription="Validate and save the row" Image16by16="$webresource:new_/img/validate16.png" Image32by32="$webresource:new_/img/validate32.png" ModernImage="$webresource:new_/img/validate.svg" />
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
  assert.deepStrictEqual(
    document.views.map((view) => view.scope),
    ["Form", "HomepageGrid", "SubGrid"],
  );
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
  const button = view.customActions[0].commandUI;
  assert.strictEqual(button?.kind === "Button" ? button.alt : undefined, "Validate");
  assert.strictEqual(button?.kind === "Button" ? button.toolTipTitle : undefined, "Validate");
  assert.strictEqual(
    button?.kind === "Button" ? button.toolTipDescription : undefined,
    "Validate and save the row",
  );
  assert.strictEqual(
    button?.kind === "Button" ? button.image32x32?.webResourceUniqueName : undefined,
    "new_/img/validate32.png",
  );
  assert.strictEqual(
    button?.kind === "Button" ? button.modernImage?.webResourceUniqueName : undefined,
    "new_/img/validate.svg",
  );
  assert.strictEqual(view.hideActions[0].hideActionId, "new.account.Form.Hide.Save");
  assert.strictEqual(view.commandDefinitions[0].enableRuleRefs[0], "new.account.Enable");
  assert.strictEqual(view.commandDefinitions[0].actions[0].kind, "JavaScriptFunction");
  assert.strictEqual(view.enableRules[0].steps[0].kind, "CustomRule");
  assert.strictEqual(view.displayRules[0].steps[0].kind, "EntityPrivilegeRule");
  assert.strictEqual(view.locLabels[0].titles[0].description, "Validate & Save");
  assert.strictEqual(view.unknownNodeRanges.length, 1);
  assert.strictEqual(document.views[1].customActions.length, 0);
  assert.strictEqual(document.views[2].customActions.length, 0);
});

test("reads common enable rule step types", () => {
  const [document] = readRibbonDocuments(
    `<RibbonDiffXml>
  <RuleDefinitions>
    <EnableRules>
      <EnableRule Id="new.account.Enable">
        <SelectionCountRule AppliesTo="SelectedEntity" Minimum="1" Maximum="2" Default="true" />
        <RecordPrivilegeRule PrivilegeType="AppendTo" AppliesTo="PrimaryEntity" InvertResult="true" />
        <EntityRule EntityName="account" AppliesTo="SelectedEntity" Context="HomePageGrid" />
        <CommandClientTypeRule Type="Legacy" />
        <UnknownRule Foo="Bar" />
      </EnableRule>
    </EnableRules>
  </RuleDefinitions>
</RibbonDiffXml>`,
    { kind: "Application" },
  );

  const steps = document.views[0].enableRules[0].steps;

  assert.deepStrictEqual(
    steps.map((step) => step.kind),
    ["SelectionCountRule", "RecordPrivilegeRule", "EntityRule", "CommandClientTypeRule", "Unknown"],
  );
  assert.strictEqual(steps[0].kind === "SelectionCountRule" ? steps[0].minimum : undefined, 1);
  assert.strictEqual(steps[0].kind === "SelectionCountRule" ? steps[0].maximum : undefined, 2);
  assert.strictEqual(
    steps[1].kind === "RecordPrivilegeRule" ? steps[1].privilegeType : undefined,
    "AppendTo",
  );
  assert.strictEqual(steps[2].kind === "EntityRule" ? steps[2].context : undefined, "HomePageGrid");
  assert.strictEqual(
    steps[3].kind === "CommandClientTypeRule" ? steps[3].type : undefined,
    "Legacy",
  );
  assert.match(steps[4].kind === "Unknown" ? steps[4].raw : "", /UnknownRule/);
});

test("projects entity ribbon nodes into scoped views", () => {
  const multiScopeXml = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.account.Form.Button.CustomAction" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.account.Form.Button" Command="new.account.Form.Command" LabelText="$LocLabels:new.account.Form.Label" />
      </CommandUIDefinition>
    </CustomAction>
    <CustomAction Id="new.account.HomepageGrid.Button.CustomAction" Location="Mscrm.HomepageGrid.account.MainTab.Management.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.account.HomepageGrid.Button" Command="new.account.HomepageGrid.Command" />
      </CommandUIDefinition>
    </CustomAction>
    <HideCustomAction HideActionId="new.account.SubGrid.Hide.Refresh" Location="Mscrm.SubGrid.account.MainTab.Management.Controls._children" />
  </CustomActions>
  <CommandDefinitions>
    <CommandDefinition Id="new.account.Form.Command">
      <EnableRules><EnableRule Id="new.account.Shared.Enable" /></EnableRules>
    </CommandDefinition>
    <CommandDefinition Id="new.account.HomepageGrid.Command" />
  </CommandDefinitions>
  <RuleDefinitions>
    <EnableRules><EnableRule Id="new.account.Shared.Enable" /></EnableRules>
  </RuleDefinitions>
  <LocLabels>
    <LocLabel Id="new.account.Form.Label"><Titles><Title languagecode="1033" description="Run" /></Titles></LocLabel>
  </LocLabels>
</RibbonDiffXml>`;

  const [document] = readRibbonDocuments(multiScopeXml, {
    kind: "Entity",
    entityLogicalName: "account",
  });
  const [form, homepageGrid, subGrid] = document.views;

  assert.deepStrictEqual(
    form.customActions.map((action) => action.id),
    ["new.account.Form.Button.CustomAction"],
  );
  assert.deepStrictEqual(
    form.commandDefinitions.map((command) => command.id),
    ["new.account.Form.Command"],
  );
  assert.deepStrictEqual(
    form.enableRules.map((rule) => rule.id),
    ["new.account.Shared.Enable"],
  );
  assert.deepStrictEqual(
    form.locLabels.map((label) => label.id),
    ["new.account.Form.Label"],
  );
  assert.deepStrictEqual(
    homepageGrid.customActions.map((action) => action.id),
    ["new.account.HomepageGrid.Button.CustomAction"],
  );
  assert.deepStrictEqual(
    homepageGrid.commandDefinitions.map((command) => command.id),
    ["new.account.HomepageGrid.Command"],
  );
  assert.deepStrictEqual(
    subGrid.hideActions.map((action) => action.hideActionId),
    ["new.account.SubGrid.Hide.Refresh"],
  );
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
  assert.strictEqual(documents[0].kind, "Entity");
  assert.strictEqual(documents[0].entityLogicalName, "account");
  assert.strictEqual(documents[1].kind, "Entity");
  assert.strictEqual(documents[1].entityLogicalName, "contact");
  assert.ok(documents[0].ribbonRange.start > 0);
  assert.strictEqual(documents[1].views[0].customActions.length, 0);
});

test("infers entity logical name from existing ribbon locations", () => {
  const flatXml = `<ImportExportXml>
  <Entities>
    <Entity>
      <Name LocalizedName="Account" OriginalName="">Account</Name>
      <RibbonDiffXml>
        <CustomActions>
          <CustomAction Id="new.account.Form.Action" Location="Mscrm.Form.account.MainTab.Save.Controls._children" />
          <CustomAction Id="new.account.Grid.Action" Location="Mscrm.HomepageGrid.account.MainTab.Management.Controls._children" />
          <CustomAction Id="new.account.Wrong.Action" Location="Mscrm.Form.Account.MainTab.Save.Controls._children" />
        </CustomActions>
      </RibbonDiffXml>
    </Entity>
  </Entities>
</ImportExportXml>`;

  const [document] = readRibbonDocuments(flatXml, {
    sourceId: "flat",
    fileUri: "/tmp/customizations.xml",
  });

  assert.strictEqual(document.entityLogicalName, "account");
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
