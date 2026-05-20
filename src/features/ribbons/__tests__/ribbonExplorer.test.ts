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
    <CustomAction Id="new.account.Form.Button.CustomAction" Location="Mscrm.Form.account.MainTab.Save.Controls._children" />
  </CustomActions>
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
