import assert from "node:assert";
import test from "node:test";
import { applyRibbonPatches, applyRibbonPatchSequence } from "../ribbonPatchWriter";
import { readRibbonDocuments } from "../ribbonXmlReader";
import {
  createCommandDefinitionPatches,
  createCommandActionPatch,
  createCommandActionReplacePatch,
  createCommandRuleRefPatch,
  createCustomButtonReplacePatch,
  createCustomButtonPatches,
  createDeleteNodePatch,
  createDisplayRulePatches,
  createEnableRulePatches,
  createHideActionReplacePatch,
  createHideActionPatches,
  createLocLabelTitlePatch,
  createLocLabelTitleReplacePatch,
  createLocLabelPatches,
  createNodeAttributeValuePatch,
  createOobButtonReorderPatches,
  createOobStubReplacementPatches,
  createRuleStepReplacePatch,
  createSwapNodePatches,
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
      alt: "Validate",
      toolTipTitle: "Validate",
      toolTipDescription: "Validate and save the row",
      image16x16: "new_/icons/save16.png",
      image32x32: "new_/icons/save32.png",
      modernImage: "new_/icons/save.svg",
      action: {
        kind: "JavaScriptFunction",
        library: "new_/scripts/account.js",
        functionName: "validateAndSave",
        parameters: [
          { kind: "Crm", value: "PrimaryControl" },
          { kind: "Crm", value: "SelectedControl" },
        ],
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
  const button = form.customActions[0].commandUI;
  assert.strictEqual(button?.kind === "Button" ? button.alt : undefined, "Validate");
  assert.strictEqual(button?.kind === "Button" ? button.toolTipTitle : undefined, "Validate");
  assert.strictEqual(
    button?.kind === "Button" ? button.toolTipDescription : undefined,
    "Validate and save the row",
  );
  assert.strictEqual(
    button?.kind === "Button" ? button.modernImage?.webResourceUniqueName : undefined,
    "new_/icons/save.svg",
  );
  assert.strictEqual(form.commandDefinitions[0].actions[0].kind, "JavaScriptFunction");
  assert.deepStrictEqual(
    form.commandDefinitions[0].actions[0].kind === "JavaScriptFunction"
      ? form.commandDefinitions[0].actions[0].parameters
      : [],
    [
      { kind: "Crm", value: "PrimaryControl" },
      { kind: "Crm", value: "SelectedControl" },
    ],
  );
  assert.strictEqual(form.locLabels[0].titles[0].description, "Validate and save");
  assert.match(updated, /Library="\$webresource:new_\/scripts\/account\.js"/);
  assert.match(updated, /LabelText="\$LocLabels:d365tools\.account\.Form\.Validate\.Label"/);
  assert.match(
    updated,
    /LabelText="\$LocLabels:d365tools\.account\.Form\.Validate\.Label" Alt="Validate" ToolTipTitle="Validate" ToolTipDescription="Validate and save the row" Image16by16="\$webresource:new_\/icons\/save16\.png" Image32by32="\$webresource:new_\/icons\/save32\.png" ModernImage="\$webresource:new_\/icons\/save\.svg" Sequence="10"/,
  );
  assert.match(updated, /<CrmParameter Value="PrimaryControl" \/>/);
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

test("creates an OOB command override with empty action chain", () => {
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
      id: "Mscrm.SavePrimary",
    }),
  );
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  assert.deepStrictEqual(
    updatedDocument.views.map((view) => view.commandDefinitions.map((command) => command.id)),
    [["Mscrm.SavePrimary"], [], []],
  );
  assert.match(updated, /<CommandDefinition Id="Mscrm\.SavePrimary">/);
  assert.match(updated, /<EnableRules><\/EnableRules>/);
  assert.match(updated, /<DisplayRules><\/DisplayRules>/);
  assert.match(updated, /<Actions><\/Actions>/);
});

test("creates OOB hide actions and replacement button stubs as one patch batch", () => {
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
    createOobStubReplacementPatches(document, [
      {
        hideActionId: "d365tools.account.Form.Hide.Mscrm.SavePrimary",
        hideLocation: "Mscrm.Form.account.Save",
        customActionId: "d365tools.account.Form.SavePrimary.CustomAction",
        location: "Mscrm.Form.account.MainTab.Save.Controls._children",
        sequence: 10,
        buttonId: "d365tools.account.Form.SavePrimary.Button",
        commandId: "d365tools.account.Form.SavePrimary.Command",
        labelLocId: "d365tools.account.Form.SavePrimary.Label",
        locLabel: {
          id: "d365tools.account.Form.SavePrimary.Label",
          languageCode: 1033,
          description: "Save",
        },
      },
      {
        hideActionId: "d365tools.account.Form.Hide.Mscrm.SaveAndClosePrimary",
        customActionId: "d365tools.account.Form.SaveAndClosePrimary.CustomAction",
        location: "Mscrm.Form.account.MainTab.Save.Controls._children",
        sequence: 20,
        buttonId: "d365tools.account.Form.SaveAndClosePrimary.Button",
        commandId: "d365tools.account.Form.SaveAndClosePrimary.Command",
        labelLocId: "d365tools.account.Form.SaveAndClosePrimary.Label",
        locLabel: {
          id: "d365tools.account.Form.SaveAndClosePrimary.Label",
          languageCode: 1033,
          description: "Save and close",
        },
      },
    ]),
  );
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const form = updatedDocument.views[0];

  assert.strictEqual(form.hideActions.length, 2);
  assert.strictEqual(form.customActions.length, 2);
  assert.strictEqual(form.commandDefinitions.length, 2);
  assert.strictEqual(form.locLabels.length, 2);
  assert.match(
    updated,
    /<HideCustomAction HideActionId="d365tools\.account\.Form\.Hide\.Mscrm\.SavePrimary" Location="Mscrm\.Form\.account\.Save" \/>/,
  );
  assert.match(updated, /<Actions><\/Actions>/);
  assert.match(updated, /<Title languagecode="1033" description="Save and close" \/>/);
});

test("creates OOB reorder actions without custom command definitions", () => {
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
    createOobButtonReorderPatches(document, [
      {
        hideActionId: "d365tools.account.Form.Hide.Mscrm.SaveAndClosePrimary",
        hideLocation: "Mscrm.Form.account.SaveAndClose",
        customActionId: "d365tools.account.Form.SaveAndClosePrimary.CustomAction",
        location: "Mscrm.Form.account.MainTab.Save.Controls._children",
        sequence: 10,
        buttonId: "d365tools.account.Form.SaveAndClosePrimary.Button",
        commandId: "Mscrm.SaveAndClosePrimary",
        labelLocId: "d365tools.account.Form.SaveAndClosePrimary.Label",
        locLabel: {
          id: "d365tools.account.Form.SaveAndClosePrimary.Label",
          languageCode: 1033,
          description: "Save and close",
        },
      },
      {
        hideActionId: "d365tools.account.Form.Hide.Mscrm.SavePrimary",
        hideLocation: "Mscrm.Form.account.Save",
        customActionId: "d365tools.account.Form.SavePrimary.CustomAction",
        location: "Mscrm.Form.account.MainTab.Save.Controls._children",
        sequence: 20,
        buttonId: "d365tools.account.Form.SavePrimary.Button",
        commandId: "Mscrm.SavePrimary",
        labelLocId: "d365tools.account.Form.SavePrimary.Label",
        locLabel: {
          id: "d365tools.account.Form.SavePrimary.Label",
          languageCode: 1033,
          description: "Save",
        },
      },
    ]),
  );
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const form = updatedDocument.views[0];

  assert.strictEqual(form.hideActions.length, 2);
  assert.strictEqual(form.customActions.length, 2);
  assert.strictEqual(form.commandDefinitions.length, 0);
  assert.deepStrictEqual(
    form.customActions.map((action) =>
      action.commandUI?.kind === "Button" ? action.commandUI.command : undefined,
    ),
    ["Mscrm.SaveAndClosePrimary", "Mscrm.SavePrimary"],
  );
  assert.doesNotMatch(updated, /<CommandDefinitions>/);
  assert.match(updated, /Sequence="10"/);
  assert.match(updated, /Sequence="20"/);
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

test("adds URL action options and named parameters", () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="d365tools.account.Form.Open.Command" />
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  const updated = applyRibbonPatchSequence(source, [
    createCommandActionPatch(document, document.views[0].commandDefinitions[0], {
      kind: "Url",
      address: "$webresource:new_/page.htm",
      passParams: true,
      winMode: 1,
      winParams: "height=600,width=800",
      parameters: [
        { kind: "Crm", name: "recordId", value: "FirstPrimaryItemId" },
        { kind: "String", name: "source", value: "ribbon" },
      ],
    }),
  ]);

  assert.match(
    updated,
    /<Url Address="\$webresource:new_\/page\.htm" PassParams="true" WinMode="1" WinParams="height=600,width=800">/,
  );
  assert.match(updated, /<CrmParameter Name="recordId" Value="FirstPrimaryItemId" \/>/);
  assert.match(updated, /<StringParameter Name="source" Value="ribbon" \/>/);
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

test("creates custom rules with CRM parameters", () => {
  const source = `<RibbonDiffXml>
  <RuleDefinitions />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });

  const updated = applyRibbonPatchSequence(
    source,
    createEnableRulePatches(document, {
      id: "d365tools.account.Form.EnableRule",
      step: {
        kind: "CustomRule",
        library: "new_/scripts/account.js",
        functionName: "canRun",
        parameters: [{ kind: "Crm", value: "PrimaryControl" }],
      },
    }),
  );
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const step = updatedDocument.views[0].enableRules[0].steps[0];

  assert.strictEqual(step.kind, "CustomRule");
  assert.deepStrictEqual(step.kind === "CustomRule" ? step.parameters : [], [
    { kind: "Crm", value: "PrimaryControl" },
  ]);
  assert.match(updated, /<CrmParameter Value="PrimaryControl" \/>/);
});

test("creates common enable rule step types", () => {
  const source = `<RibbonDiffXml>
  <RuleDefinitions />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  const cases = [
    {
      id: "new.SelectionCount",
      step: {
        kind: "SelectionCountRule" as const,
        appliesTo: "SelectedEntity" as const,
        minimum: 1,
        maximum: 1,
      },
    },
    {
      id: "new.RecordPrivilege",
      step: {
        kind: "RecordPrivilegeRule" as const,
        privilegeType: "AppendTo" as const,
        appliesTo: "PrimaryEntity" as const,
      },
    },
    {
      id: "new.Entity",
      step: {
        kind: "EntityRule" as const,
        entityName: "account",
        appliesTo: "SelectedEntity" as const,
        context: "HomePageGrid",
      },
    },
    {
      id: "new.Legacy",
      step: {
        kind: "CommandClientTypeRule" as const,
        type: "Legacy" as const,
      },
    },
  ];

  for (const input of cases) {
    const updated = applyRibbonPatchSequence(source, [createEnableRulePatches(document, input)[0]]);
    const [updatedDocument] = readRibbonDocuments(updated, {
      sourceId: "source",
      fileUri: "/tmp/RibbonDiffXml.xml",
      kind: "Application",
    });

    assert.strictEqual(updatedDocument.views[0].enableRules[0].steps[0].kind, input.step.kind);
  }
});

test("creates flat display rule step types", () => {
  const source = `<RibbonDiffXml>
  <RuleDefinitions />
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  const cases = [
    {
      id: "new.FormType",
      step: {
        kind: "FormTypeRule" as const,
        type: "Main" as const,
      },
    },
    {
      id: "new.EntityProperty",
      step: {
        kind: "EntityPropertyRule" as const,
        propertyName: "HasNotes" as const,
        propertyValue: true,
      },
    },
    {
      id: "new.MiscPrivilege",
      step: {
        kind: "MiscellaneousPrivilegeRule" as const,
        privilegeName: "ExportToExcel",
        privilegeDepth: "Basic" as const,
      },
    },
    {
      id: "new.OrganizationSetting",
      step: {
        kind: "OrganizationSettingRule" as const,
        setting: "IsSharepointEnabled" as const,
      },
    },
    {
      id: "new.HideForTablet",
      step: {
        kind: "HideForTabletExperienceRule" as const,
      },
    },
  ];

  for (const input of cases) {
    const updated = applyRibbonPatchSequence(source, [
      createDisplayRulePatches(document, input)[0],
    ]);
    const [updatedDocument] = readRibbonDocuments(updated, {
      sourceId: "source",
      fileUri: "/tmp/RibbonDiffXml.xml",
      kind: "Application",
    });

    assert.strictEqual(updatedDocument.views[0].displayRules[0].steps[0].kind, input.step.kind);
    assert.match(updated, new RegExp(`<${input.step.kind}`));
  }
});

test("replaces rule steps with common enable rule step types", () => {
  const source = `<RibbonDiffXml>
  <RuleDefinitions>
    <EnableRules>
      <EnableRule Id="old.enable">
        <CustomRule Library="$webresource:new_/scripts/account.js" FunctionName="isEnabled" />
      </EnableRule>
    </EnableRules>
  </RuleDefinitions>
</RibbonDiffXml>`;
  const replacements = [
    {
      kind: "SelectionCountRule" as const,
      minimum: 1,
      maximum: 1,
    },
    {
      kind: "RecordPrivilegeRule" as const,
      privilegeType: "Read" as const,
    },
    {
      kind: "EntityRule" as const,
      entityName: "account",
    },
  ];

  for (const replacement of replacements) {
    const [document] = readRibbonDocuments(source, {
      sourceId: "source",
      fileUri: "/tmp/RibbonDiffXml.xml",
      kind: "Application",
    });
    const updated = applyRibbonPatchSequence(source, [
      createRuleStepReplacePatch(
        document.sourceText,
        document.views[0].enableRules[0].steps[0],
        replacement,
      ),
    ]);
    const [updatedDocument] = readRibbonDocuments(updated, {
      sourceId: "source",
      fileUri: "/tmp/RibbonDiffXml.xml",
      kind: "Application",
    });

    assert.strictEqual(updatedDocument.views[0].enableRules[0].steps[0].kind, replacement.kind);
  }
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

test("replaces editable ribbon nodes without touching surrounding XML", () => {
  const source = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="old.action" Location="old.location" Sequence="10">
      <CommandUIDefinition>
        <Button Id="old.button" Command="old.command" LabelText="Old label" />
      </CommandUIDefinition>
    </CustomAction>
    <HideCustomAction HideActionId="old.hide" Location="old.location" />
  </CustomActions>
  <CommandDefinitions>
    <CommandDefinition Id="old.command">
      <Actions>
        <Url Address="https://old.example" />
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions>
    <DisplayRules>
      <DisplayRule Id="old.rule">
        <ValueRule Field="statuscode" Value="1" />
      </DisplayRule>
    </DisplayRules>
  </RuleDefinitions>
  <LocLabels>
    <LocLabel Id="old.label">
      <Titles>
        <Title languagecode="1033" description="Old label" />
      </Titles>
    </LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const view = document.views[0];

  const updated = applyRibbonPatches(source, [
    createCustomButtonReplacePatch(document.sourceText, view.customActions[0].range, {
      customActionId: "new.action",
      location: "new.location",
      sequence: 20,
      buttonId: "new.button",
      commandId: "new.command",
      labelText: "New label",
      alt: "New alt",
      toolTipTitle: "New title",
      toolTipDescription: "New description",
      image16x16: "new_/icons/new16.png",
      image32x32: "new_/icons/new32.png",
      modernImage: "new_/icons/new.svg",
      action: { kind: "Url", address: "" },
    }),
    createHideActionReplacePatch(document.sourceText, view.hideActions[0].range, {
      hideActionId: "new.hide",
      location: "new.location",
    }),
    createCommandActionReplacePatch(document.sourceText, view.commandDefinitions[0].actions[0], {
      kind: "JavaScriptFunction",
      library: "new_/scripts/account.js",
      functionName: "validateAndSave",
    }),
    createRuleStepReplacePatch(document.sourceText, view.displayRules[0].steps[0], {
      kind: "ValueRule",
      field: "statecode",
      value: "0",
      invertResult: true,
    }),
    createLocLabelTitleReplacePatch(document.sourceText, view.locLabels[0].titles[0], {
      languageCode: 1033,
      description: "New label",
    }),
  ]);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const updatedView = updatedDocument.views[0];

  assert.strictEqual(updatedView.customActions[0].id, "new.action");
  assert.strictEqual(updatedView.hideActions[0].hideActionId, "new.hide");
  assert.strictEqual(updatedView.commandDefinitions[0].actions[0].kind, "JavaScriptFunction");
  assert.strictEqual(updatedView.displayRules[0].steps[0].kind, "ValueRule");
  assert.strictEqual(updatedView.locLabels[0].titles[0].description, "New label");
  const button = updatedView.customActions[0].commandUI;
  assert.strictEqual(button?.kind === "Button" ? button.alt : undefined, "New alt");
  assert.strictEqual(button?.kind === "Button" ? button.toolTipTitle : undefined, "New title");
  assert.strictEqual(
    button?.kind === "Button" ? button.toolTipDescription : undefined,
    "New description",
  );
  assert.strictEqual(
    button?.kind === "Button" ? button.modernImage?.webResourceUniqueName : undefined,
    "new_/icons/new.svg",
  );
  assert.match(updated, /<CommandDefinitions>/);
  assert.doesNotMatch(updated, /old\.hide/);
});

test("replaces node ids without rebuilding child XML", () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="old.command" CustomAttr="keep">
      <!-- keep comment -->
      <Actions>
        <Url Address="https://contoso.example" />
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions>
    <EnableRules>
      <EnableRule Id="old.enable"><CustomRule Library="$webresource:new_/scripts/account.js" FunctionName="isEnabled" /></EnableRule>
    </EnableRules>
  </RuleDefinitions>
  <LocLabels>
    <LocLabel Id="old.label"><Titles /></LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const view = document.views[0];

  const updated = applyRibbonPatches(source, [
    createNodeAttributeValuePatch(
      document.sourceText,
      view.commandDefinitions[0].range,
      "Id",
      "new.command",
    ),
    createNodeAttributeValuePatch(
      document.sourceText,
      view.enableRules[0].range,
      "Id",
      "new.enable",
    ),
    createNodeAttributeValuePatch(document.sourceText, view.locLabels[0].range, "Id", "new.label"),
  ]);

  assert.match(updated, /<CommandDefinition Id="new\.command" CustomAttr="keep">/);
  assert.match(updated, /<!-- keep comment -->/);
  assert.match(updated, /<EnableRule Id="new\.enable">/);
  assert.match(updated, /<LocLabel Id="new\.label">/);
});

test("adds a language title to an existing loc label", () => {
  const source = `<RibbonDiffXml>
  <LocLabels>
    <LocLabel Id="old.label">
      <Titles>
        <Title languagecode="1033" description="Name" />
      </Titles>
    </LocLabel>
  </LocLabels>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  const updated = applyRibbonPatchSequence(source, [
    createLocLabelTitlePatch(document, document.views[0].locLabels[0].range, {
      languageCode: 1058,
      description: "Name UA",
    }),
  ]);
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.deepStrictEqual(
    updatedDocument.views[0].locLabels[0].titles.map((title) => title.languageCode),
    [1033, 1058],
  );
  assert.match(updated, /<Title languagecode="1058" description="Name UA" \/>/);
});

test("swaps sibling XML nodes without changing their content", () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="first" CustomAttr="keep">
      <Actions><Url Address="https://first.example" /></Actions>
    </CommandDefinition>
    <CommandDefinition Id="second">
      <!-- keep comment -->
      <Actions><Url Address="https://second.example" /></Actions>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const [first, second] = document.views[0].commandDefinitions;

  const updated = applyRibbonPatches(
    source,
    createSwapNodePatches(document.sourceText, first.range, second.range),
  );
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.deepStrictEqual(
    updatedDocument.views[0].commandDefinitions.map((command) => command.id),
    ["second", "first"],
  );
  assert.match(updated, /<!-- keep comment -->/);
  assert.match(updated, /CustomAttr="keep"/);
});

test("swaps sibling XML nodes in queued patch order when node sizes differ", () => {
  const source = `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="short"><Actions><Url Address="https://short.example" /></Actions></CommandDefinition>
    <CommandDefinition Id="longer">
      <EnableRules>
        <EnableRule Id="new.Enabled" />
      </EnableRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:new_/scripts/account.js" FunctionName="run" />
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(source, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });
  const [short, longer] = document.views[0].commandDefinitions;

  const updated = applyRibbonPatchSequence(
    source,
    createSwapNodePatches(document.sourceText, short.range, longer.range),
  );
  const [updatedDocument] = readRibbonDocuments(updated, {
    sourceId: "source",
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Application",
  });

  assert.deepStrictEqual(
    updatedDocument.views[0].commandDefinitions.map((command) => command.id),
    ["longer", "short"],
  );
  assert.match(updated, /<JavaScriptFunction Library="\$webresource:new_\/scripts\/account\.js"/);
  assert.match(updated, /https:\/\/short\.example/);
});
