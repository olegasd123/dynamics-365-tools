import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import * as vscode from "vscode";
import { ConfigurationService } from "../../config/configurationService";
import {
  RibbonDocumentNode,
  RibbonExplorerProvider,
  RibbonItemNode,
  RibbonSectionNode,
  RibbonSourceNode,
} from "../ribbonExplorer";
import { RibbonRepository } from "../ribbonRepository";
import { RibbonSourceLocator } from "../ribbonSourceLocator";

test("renders located ribbon documents as a read-only tree", async () => {
  const workspaceRoot = await makeWorkspace();
  (vscode.workspace as any).workspaceFolders = [{ uri: vscode.Uri.file(workspaceRoot) }];
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
      <EnableRules><EnableRule Id="new.account.Enable" /></EnableRules>
      <Actions>
        <JavaScriptFunction Library="$webresource:new_/account.js" FunctionName="run" />
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
</RibbonDiffXml>`,
  );
  const explorer = new RibbonExplorerProvider(
    new ConfigurationService(),
    new RibbonSourceLocator(),
    new RibbonRepository(),
  );

  const roots = await explorer.getChildren();
  assert.strictEqual(roots.length, 1);
  assert.ok(roots[0] instanceof RibbonSourceNode);

  const documents = await explorer.getChildren(roots[0]);
  assert.strictEqual(documents.length, 1);
  assert.ok(documents[0] instanceof RibbonDocumentNode);
  assert.strictEqual(documents[0].label, "account");

  const views = await explorer.getChildren(documents[0]);
  const sections = await explorer.getChildren(views[0]);
  assert.ok(sections[0] instanceof RibbonSectionNode);
  assert.strictEqual(sections[0].label, "Custom Actions");
  assert.strictEqual(sections[0].description, "1");

  const items = await explorer.getChildren(sections[0]);
  assert.strictEqual(items[0].label, "new.account.Form.Button.CustomAction");
  assert.ok(items[0] instanceof RibbonItemNode);

  const buttonNodes = await explorer.getChildren(items[0]);
  assert.strictEqual(buttonNodes[0].label, "Button: new.account.Form.Button");

  const commandSection = sections.find((section) => section.label === "Command Definitions");
  assert.ok(commandSection);
  const commands = await explorer.getChildren(commandSection);
  const commandChildren = await explorer.getChildren(commands[0]);
  assert.deepStrictEqual(
    commandChildren.map((child) => child.label),
    ["EnableRules", "DisplayRules", "Actions"],
  );

  const actionNodes = await explorer.getChildren(commandChildren[2]);
  assert.strictEqual(actionNodes[0].label, "JavaScript: run");
});

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "d365-ribbon-explorer-"));
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
