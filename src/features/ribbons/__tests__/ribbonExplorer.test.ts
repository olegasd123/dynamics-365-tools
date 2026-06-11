import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { NodeWorkspaceFiles } from "../../../testSupport/fakes";
import { ConfigurationService } from "@features/config/configurationService";
import {
  RibbonDocumentNode,
  RibbonEmptyNode,
  RibbonExplorerProvider,
  RibbonItemNode,
  RibbonSectionNode,
  RibbonSourceNode,
  RibbonViewNode,
} from "../ribbonExplorer";
import { RibbonEditorState } from "../ribbonEditorState";
import { RibbonRepository } from "../ribbonRepository";
import { RibbonSourceLocator } from "../ribbonSourceLocator";

test("renders located ribbon documents as a read-only tree", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(
    workspaceRoot,
    "Entities/account/RibbonDiffXml.xml",
    `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.account.Form.Button.CustomAction" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.account.Form.Button" Command="new.account.Command" LabelText="Run" Alt="Run" ToolTipTitle="Run" ToolTipDescription="Run the command" Image16by16="$webresource:new_/icons/run16.png" Image32by32="$webresource:new_/icons/run32.png" ModernImage="$webresource:new_/icons/run.svg" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <Templates>
    <RibbonTemplates Id="Mscrm.Templates" />
  </Templates>
  <CommandDefinitions>
    <CommandDefinition Id="new.account.Command">
      <EnableRules><EnableRule Id="new.account.Enable" /></EnableRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:new_/account.js" FunctionName="run">
          <CrmParameter Value="PrimaryControl" />
          <CrmParameter Value="SelectedControl" />
        </JavaScriptFunction>
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions>
    <EnableRules>
      <EnableRule Id="new.account.Enable">
        <CommandClientTypeRule Type="Modern" />
      </EnableRule>
    </EnableRules>
  </RuleDefinitions>
  <CustomXml>
    <Value />
  </CustomXml>
</RibbonDiffXml>`,
  );
  const explorer = new RibbonExplorerProvider(
    createConfiguration(workspaceRoot),
    new RibbonSourceLocator(),
    new RibbonEditorState(new RibbonRepository()),
  );

  const roots = await explorer.getChildren();
  assert.strictEqual(roots.length, 1);
  assert.ok(roots[0] instanceof RibbonSourceNode);

  const documents = await explorer.getChildren(roots[0]);
  assert.strictEqual(documents.length, 1);
  assert.ok(documents[0] instanceof RibbonDocumentNode);
  assert.strictEqual(documents[0].label, "account");

  const views = await explorer.getChildren(documents[0]);
  assert.deepStrictEqual(
    views.map((view) => view.label),
    ["Form", "HomepageGrid", "SubGrid"],
  );
  const sections = await explorer.getChildren(views[0]);
  assert.ok(sections[0] instanceof RibbonSectionNode);
  assert.strictEqual(sections[0].label, "Custom Actions");
  assert.strictEqual(sections[0].description, "1");
  assert.ok(sections.some((section) => section.label === "Templates"));
  assert.ok(sections.some((section) => section.label === "Unknown XML"));

  const items = await explorer.getChildren(sections[0]);
  assert.strictEqual(items[0].label, "new.account.Form.Button.CustomAction");
  assert.ok(items[0] instanceof RibbonItemNode);

  const buttonNodes = await explorer.getChildren(items[0]);
  assert.strictEqual(buttonNodes[0].label, "Button: new.account.Form.Button");
  assert.deepStrictEqual((buttonNodes[0] as RibbonItemNode).details, [
    ["Id", "new.account.Form.Button"],
    ["Kind", "Button"],
    ["Command", "new.account.Command"],
    ["Label", "Run"],
    ["Alt", "Run"],
    ["Tool tip title", "Run"],
    ["Tool tip description", "Run the command"],
    ["Image 16", "new_/icons/run16.png"],
    ["Image 32", "new_/icons/run32.png"],
    ["Modern image", "new_/icons/run.svg"],
    ["Sequence", undefined],
  ]);

  const commandSection = sections.find((section) => section.label === "Command Definitions");
  assert.ok(commandSection);
  const commands = await explorer.getChildren(commandSection);
  const commandChildren = await explorer.getChildren(commands[0]);
  assert.deepStrictEqual(
    commandChildren.map((child) => child.label),
    ["EnableRules", "DisplayRules", "Actions"],
  );
  assert.ok(commandChildren[2] instanceof RibbonItemNode);
  assert.deepStrictEqual(
    (commandChildren[0] as RibbonItemNode).editTarget?.range,
    (commands[0] as RibbonItemNode).editTarget?.range,
  );
  const enableRefNodes = await explorer.getChildren(commandChildren[0]);
  assert.strictEqual(enableRefNodes[0].contextValue, "d365RibbonRuleRef");
  assert.ok((enableRefNodes[0] as RibbonItemNode).editTarget);
  assert.strictEqual(commandChildren[2].contextValue, "d365RibbonActions");
  assert.deepStrictEqual(
    commandChildren[2].editTarget?.range,
    (commands[0] as RibbonItemNode).editTarget?.range,
  );

  const actionNodes = await explorer.getChildren(commandChildren[2]);
  assert.strictEqual(actionNodes[0].label, "JavaScript: run");
  const parameterNodes = await explorer.getChildren(actionNodes[0]);
  assert.deepStrictEqual(
    parameterNodes.map((node) => node.label),
    ["1. PrimaryControl", "2. SelectedControl"],
  );
  assert.deepStrictEqual((actionNodes[0] as RibbonItemNode).details[3], [
    "Parameters",
    ["PrimaryControl", "SelectedControl"],
  ]);

  const templatesSection = sections.find((section) => section.label === "Templates");
  assert.ok(templatesSection);
  const templateNodes = await explorer.getChildren(templatesSection);
  assert.strictEqual(templateNodes[0].label, "Templates");

  const unknownSection = sections.find((section) => section.label === "Unknown XML");
  assert.ok(unknownSection);
  const unknownNodes = await explorer.getChildren(unknownSection);
  assert.strictEqual(unknownNodes[0].label, "Unknown XML: CustomXml");
});

test("shows empty button metadata details", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(
    workspaceRoot,
    "Entities/account/RibbonDiffXml.xml",
    `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.account.Form.Button.CustomAction" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.account.Form.Button" Command="new.account.Command" LabelText="Run" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
</RibbonDiffXml>`,
  );
  const explorer = new RibbonExplorerProvider(
    createConfiguration(workspaceRoot),
    new RibbonSourceLocator(),
    new RibbonEditorState(new RibbonRepository()),
  );

  const roots = await explorer.getChildren();
  const documents = await explorer.getChildren(roots[0]);
  const views = await explorer.getChildren(documents[0]);
  const sections = await explorer.getChildren(views[0]);
  const customActions = await explorer.getChildren(sections[0]);
  const buttonNodes = await explorer.getChildren(customActions[0]);
  const details = (buttonNodes[0] as RibbonItemNode).details;

  assert.deepStrictEqual(
    details.filter(([name]) =>
      [
        "Alt",
        "Tool tip title",
        "Tool tip description",
        "Image 16",
        "Image 32",
        "Modern image",
      ].includes(name),
    ),
    [
      ["Alt", undefined],
      ["Tool tip title", undefined],
      ["Tool tip description", undefined],
      ["Image 16", undefined],
      ["Image 32", undefined],
      ["Modern image", undefined],
    ],
  );
});

test("indexes ribbon items for quick navigation", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(
    workspaceRoot,
    "Entities/account/RibbonDiffXml.xml",
    `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.account.Form.Button.CustomAction" Location="Mscrm.Form.account.MainTab.Save.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.account.Form.Button" Command="new.account.Command" LabelText="Run" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <CommandDefinitions>
    <CommandDefinition Id="new.account.Command">
      <Actions>
        <JavaScriptFunction Library="$webresource:new_/account.js" FunctionName="runAccountCommand" />
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`,
  );
  const explorer = new RibbonExplorerProvider(
    createConfiguration(workspaceRoot),
    new RibbonSourceLocator(),
    new RibbonEditorState(new RibbonRepository()),
  );

  const results = await explorer.searchItems();
  const button = results.find((result) => result.label === "Button: new.account.Form.Button");
  const script = results.find((result) => result.label === "JavaScript: runAccountCommand");
  assert.ok(button);
  assert.ok(script);
  assert.match(button.detail, /Command: new\.account\.Command/);
  assert.match(button.detail, /Label: Run/);
  assert.match(script.detail, /Function: runAccountCommand/);

  const buttonParent = explorer.getParent(button.node);
  assert.ok(buttonParent instanceof RibbonItemNode);
  assert.strictEqual(buttonParent.label, "new.account.Form.Button.CustomAction");
  assert.ok(explorer.getParent(buttonParent) instanceof RibbonSectionNode);

  const document = results.find((result) => result.label === "account");
  assert.ok(document);
  assert.ok(explorer.getParent(document.node) instanceof RibbonSourceNode);
  const view = results.find((result) => result.label === "Form");
  assert.ok(view);
  assert.ok(view.node instanceof RibbonViewNode);
});

test("filters ribbon tree while keeping matching item ancestors", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(
    workspaceRoot,
    "AppRibbon/RibbonDiffXml.xml",
    `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.app.Button.CustomAction" Location="Mscrm.HomepageGrid.account.MainTab.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.app.Button" Command="new.Command" LabelText="Run" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <Actions>
        <JavaScriptFunction Library="$webresource:new_/app.js" FunctionName="runAppCommand" />
      </Actions>
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`,
  );
  const explorer = new RibbonExplorerProvider(
    createConfiguration(workspaceRoot),
    new RibbonSourceLocator(),
    new RibbonEditorState(new RibbonRepository()),
  );

  explorer.setFilter("runAppCommand");

  const roots = await explorer.getChildren();
  const documents = await explorer.getChildren(roots[0]);
  const sections = await explorer.getChildren(documents[0]);
  assert.deepStrictEqual(
    sections.map((section) => section.label),
    ["Command Definitions"],
  );
  assert.strictEqual(sections[0].description, "1 of 1");

  const commands = await explorer.getChildren(sections[0]);
  const commandChildren = await explorer.getChildren(commands[0]);
  const actionGroup = commandChildren.find((child) => child.label === "Actions");
  assert.ok(actionGroup);
  const actions = await explorer.getChildren(actionGroup);
  assert.deepStrictEqual(
    actions.map((action) => action.label),
    ["JavaScript: runAppCommand"],
  );

  assert.ok(
    (await explorer.searchItems()).some((result) => result.label === "Button: new.app.Button"),
  );

  explorer.clearFilter();
  const unfilteredSections = await explorer.getChildren(documents[0]);
  assert.deepStrictEqual(
    unfilteredSections.map((section) => section.label),
    [
      "Custom Actions",
      "Hide Actions",
      "Command Definitions",
      "Enable Rules",
      "Display Rules",
      "Loc Labels",
    ],
  );
  assert.strictEqual(
    unfilteredSections.find((section) => section.label === "Command Definitions")?.description,
    "1",
  );
});

test("shows an empty filtered ribbon tree when there are no matches", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(workspaceRoot, "AppRibbon/RibbonDiffXml.xml", "<RibbonDiffXml />");
  const explorer = new RibbonExplorerProvider(
    createConfiguration(workspaceRoot),
    new RibbonSourceLocator(),
    new RibbonEditorState(new RibbonRepository()),
  );

  explorer.setFilter("missing");

  const roots = await explorer.getChildren();
  assert.strictEqual(roots.length, 1);
  assert.ok(roots[0] instanceof RibbonEmptyNode);
  assert.strictEqual(roots[0].label, "No ribbon items match");
  assert.strictEqual(roots[0].description, "Filter: missing");
});

test("labels OOB command overrides in the tree", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(
    workspaceRoot,
    "Entities/account/RibbonDiffXml.xml",
    `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="Mscrm.SavePrimary">
      <EnableRules />
      <DisplayRules />
      <Actions />
    </CommandDefinition>
  </CommandDefinitions>
</RibbonDiffXml>`,
  );
  const explorer = new RibbonExplorerProvider(
    createConfiguration(workspaceRoot),
    new RibbonSourceLocator(),
    new RibbonEditorState(new RibbonRepository()),
  );

  const roots = await explorer.getChildren();
  const documents = await explorer.getChildren(roots[0]);
  const views = await explorer.getChildren(documents[0]);
  const sections = await explorer.getChildren(views[0]);
  const commandSection = sections.find((section) => section.label === "Command Definitions");
  assert.ok(commandSection);

  const commands = await explorer.getChildren(commandSection);

  assert.strictEqual(commands[0].label, "OVERRIDE: Mscrm.SavePrimary");
  assert.strictEqual(commands[0].description, "0 actions • OOB command");
});

test("shows details for built-in refs and common enable rule steps", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(
    workspaceRoot,
    "AppRibbon/RibbonDiffXml.xml",
    `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="new.Command">
      <EnableRules><EnableRule Id="Mscrm.ShowOnGrid" /></EnableRules>
    </CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions>
    <EnableRules>
      <EnableRule Id="new.Enable">
        <SelectionCountRule AppliesTo="SelectedEntity" Minimum="1" Maximum="1" />
        <RecordPrivilegeRule PrivilegeType="Read" AppliesTo="PrimaryEntity" />
        <EntityRule EntityName="account" Context="HomePageGrid" />
      </EnableRule>
    </EnableRules>
  </RuleDefinitions>
</RibbonDiffXml>`,
  );
  const explorer = new RibbonExplorerProvider(
    createConfiguration(workspaceRoot),
    new RibbonSourceLocator(),
    new RibbonEditorState(new RibbonRepository()),
  );

  const roots = await explorer.getChildren();
  const documents = await explorer.getChildren(roots[0]);
  const sections = await explorer.getChildren(documents[0]);
  const commandSection = sections.find((section) => section.label === "Command Definitions");
  const enableSection = sections.find((section) => section.label === "Enable Rules");
  assert.ok(commandSection);
  assert.ok(enableSection);

  const commands = await explorer.getChildren(commandSection);
  const commandChildren = await explorer.getChildren(commands[0]);
  const refs = await explorer.getChildren(commandChildren[0]);
  const rules = await explorer.getChildren(enableSection);
  const steps = await explorer.getChildren(rules[0]);

  assert.strictEqual(refs[0].description, "Built-in enable rule");
  assert.deepStrictEqual(
    steps.map((step) => step.description),
    ["1", "Read", "account"],
  );
  assert.deepStrictEqual((steps[0] as RibbonItemNode).details[3], ["Minimum", 1]);
});

test("scopes known OOB command overrides to matching entity views", async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(
    workspaceRoot,
    "Entities/account/RibbonDiffXml.xml",
    `<RibbonDiffXml>
  <CommandDefinitions>
    <CommandDefinition Id="Mscrm.SavePrimary" />
  </CommandDefinitions>
</RibbonDiffXml>`,
  );
  const explorer = new RibbonExplorerProvider(
    createConfiguration(workspaceRoot),
    new RibbonSourceLocator(),
    new RibbonEditorState(new RibbonRepository()),
  );

  const roots = await explorer.getChildren();
  const documents = await explorer.getChildren(roots[0]);
  const views = await explorer.getChildren(documents[0]);
  const sectionCounts = await Promise.all(
    views.map(async (view) => {
      const sections = await explorer.getChildren(view);
      return sections.find((section) => section.label === "Command Definitions")?.description;
    }),
  );

  assert.deepStrictEqual(sectionCounts, ["1", "0", "0"]);
});

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-explorer-"));
}

function createConfiguration(workspaceRoot: string): ConfigurationService {
  return new ConfigurationService(new NodeWorkspaceFiles(workspaceRoot));
}

async function writeFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}
