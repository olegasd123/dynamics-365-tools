import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { RibbonDiagnosticsService } from "../ribbonDiagnostics";
import { readRibbonDocuments } from "../ribbonXmlReader";

test("maps ribbon validation issues to VS Code diagnostics", () => {
  const sourceText = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="new.account.Action" Location="Mscrm.Form.account.MainTab.Controls._children">
      <CommandUIDefinition>
        <Button Id="new.account.Button" Command="new.account.MissingCommand" />
      </CommandUIDefinition>
    </CustomAction>
  </CustomActions>
</RibbonDiffXml>`;
  const [document] = readRibbonDocuments(sourceText, {
    fileUri: "/tmp/RibbonDiffXml.xml",
    kind: "Entity",
    entityLogicalName: "account",
  });
  const service = new RibbonDiagnosticsService();

  service.validateDocuments([document]);

  const collection = (service as any).diagnostics;
  const diagnostics = collection.entries.get("/tmp/RibbonDiffXml.xml");
  assert.strictEqual(diagnostics.length, 1);
  assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Error);
  assert.match(diagnostics[0].message, /missing CommandDefinition/);

  service.clear();
  assert.strictEqual(collection.entries.size, 0);
  service.dispose();
});
