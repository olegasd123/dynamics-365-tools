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
