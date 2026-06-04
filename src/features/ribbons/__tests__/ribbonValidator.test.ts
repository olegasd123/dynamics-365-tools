import assert from "node:assert";
import test from "node:test";
import { readRibbonDocuments } from "../ribbonXmlReader";
import { validateRibbonDocument } from "../ribbonValidator";

test("reports broken command, rule, and label references", () => {
  const [document] = readRibbonDocuments(
    `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.account.Action" Location="Mscrm.Form.account.MainTab.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.account.Button" Command="new.account.MissingCommand" LabelLocId="new.account.MissingLabel" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <CommandDefinitions>
    <CommandDefinition Id="new.account.Command">
      <EnableRules><EnableRule Id="new.account.MissingEnable" /></EnableRules>
      <Actions><JavaScriptFunction Library="" FunctionName="" /></Actions>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`,
    { kind: "Entity", entityLogicalName: "account" },
  );

  const messages = validateRibbonDocument(document).map((issue) => issue.message);

  assert.ok(
    messages.includes("Button references missing CommandDefinition 'new.account.MissingCommand'."),
  );
  assert.ok(messages.includes("Button references missing LocLabel 'new.account.MissingLabel'."));
  assert.ok(
    messages.includes(
      "CommandDefinition references missing EnableRule 'new.account.MissingEnable'.",
    ),
  );
  assert.ok(messages.includes("JavaScript library is required."));
  assert.ok(messages.includes("JavaScript function name is required."));
});

test("reports duplicate ribbon ids", () => {
  const [document] = readRibbonDocuments(
    `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.account.Action" Location="A" />
    <CustomAction Id="new.account.Action" Location="B" />
  </CustomActions>
  <CommandDefinitions>
    <CommandDefinition Id="new.account.Command" />
    <CommandDefinition Id="new.account.Command" />
  </CommandDefinitions>
</RibbonDiffXml>`,
    { kind: "Entity", entityLogicalName: "account" },
  );

  const messages = validateRibbonDocument(document).map((issue) => issue.message);

  assert.ok(messages.includes("Duplicate CustomAction Id 'new.account.Action'."));
  assert.ok(messages.includes("Duplicate CommandDefinition Id 'new.account.Command'."));
});

test("allows known OOB button commands without local command definitions", () => {
  const [document] = readRibbonDocuments(
    `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.account.Action" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.account.Button" Command="Mscrm.SavePrimary" LabelText="Save" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
</RibbonDiffXml>`,
    { kind: "Entity", entityLogicalName: "account" },
  );

  const messages = validateRibbonDocument(document).map((issue) => issue.message);

  assert.ok(!messages.includes("Button references missing CommandDefinition 'Mscrm.SavePrimary'."));
});

test("warns about unknown CRM parameters", () => {
  const [document] = readRibbonDocuments(
    `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.account.Command">
      <Actions>
        <JavaScriptFunction Library="$webresource:new_/account/ribbon.js" FunctionName="New.Account.run">
          <CrmParameter Value="ASD" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`,
    { kind: "Entity", entityLogicalName: "account" },
  );

  const messages = validateRibbonDocument(document).map((issue) => issue.message);

  assert.ok(messages.includes("Unknown CRM parameter 'ASD'."));
});

test("allows known built-in enable rule references", () => {
  const [document] = readRibbonDocuments(
    `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.account.Command">
      <EnableRules>
        <EnableRule Id="Mscrm.SelectionCountExactlyOne" />
        <EnableRule Id="Mscrm.ShowOnGrid" />
      </EnableRules>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`,
    { kind: "Entity", entityLogicalName: "account" },
  );

  const messages = validateRibbonDocument(document).map((issue) => issue.message);

  assert.ok(
    !messages.includes(
      "CommandDefinition references missing EnableRule 'Mscrm.SelectionCountExactlyOne'.",
    ),
  );
  assert.ok(
    !messages.includes("CommandDefinition references missing EnableRule 'Mscrm.ShowOnGrid'."),
  );
});

test("validates required typed rule step attributes", () => {
  const [document] = readRibbonDocuments(
    `<RibbonDiffXml>
  <RuleDefinitions>
    <EnableRules>
      <EnableRule Id="new.account.Enable">
        <SelectionCountRule />
        <RecordPrivilegeRule />
        <ValueRule />
      </EnableRule>
    </EnableRules>
  </RuleDefinitions>
</RibbonDiffXml>`,
    { kind: "Entity", entityLogicalName: "account" },
  );

  const messages = validateRibbonDocument(document).map((issue) => issue.message);

  assert.ok(messages.includes("SelectionCountRule minimum or maximum is required."));
  assert.ok(messages.includes("RecordPrivilegeRule privilege type is required."));
  assert.ok(messages.includes("ValueRule field is required."));
  assert.ok(messages.includes("ValueRule value is required."));
});

test("validates required flat display rule attributes", () => {
  const [document] = readRibbonDocuments(
    `<RibbonDiffXml>
  <RuleDefinitions>
    <DisplayRules>
      <DisplayRule Id="new.account.Display">
        <FormTypeRule />
        <EntityPropertyRule />
        <MiscellaneousPrivilegeRule />
        <OrganizationSettingRule />
        <HideForTabletExperienceRule />
        <RelationshipTypeRule />
        <ReferencingAttributeRequiredRule />
      </DisplayRule>
    </DisplayRules>
  </RuleDefinitions>
</RibbonDiffXml>`,
    { kind: "Entity", entityLogicalName: "account" },
  );

  const messages = validateRibbonDocument(document).map((issue) => issue.message);

  assert.ok(messages.includes("FormTypeRule type is required."));
  assert.ok(messages.includes("EntityPropertyRule property name is required."));
  assert.ok(messages.includes("EntityPropertyRule property value is required."));
  assert.ok(messages.includes("MiscellaneousPrivilegeRule privilege name is required."));
  assert.ok(messages.includes("OrganizationSettingRule setting is required."));
  assert.ok(messages.includes("RelationshipTypeRule type is required."));
});
