import assert from "node:assert";
import test from "node:test";
import * as path from "path";
import * as vscode from "vscode";
import { PluginAssemblyStatusBarService } from "../pluginAssemblyStatusBar";

test("assembly status bar renders last publish with environment and assembly name", () => {
  const calls: string[] = [];
  const item = {
    text: "",
    tooltip: "",
    command: "",
    show: () => calls.push("show"),
    hide: () => calls.push("hide"),
    dispose: () => calls.push("dispose"),
  };
  const originalCreateStatusBarItem = (vscode.window as any).createStatusBarItem;
  const originalAsRelativePath = (vscode.workspace as any).asRelativePath;
  (vscode.window as any).createStatusBarItem = () => item;
  (vscode.workspace as any).asRelativePath = (uri: vscode.Uri) =>
    path.relative("/workspace", uri.fsPath);

  try {
    const service = new PluginAssemblyStatusBarService("dynamics365Tools.publishAssembly");
    service.setLastPublish({
      assemblyId: "id",
      assemblyName: "MyAssembly",
      assemblyUri: vscode.Uri.file("/workspace/bin/MyAssembly.dll"),
      environment: { name: "dev", url: "https://example" },
    });

    assert.strictEqual(service.getLastPublish()?.environment.name, "dev");
    assert.strictEqual(item.text, "$(package) dev • MyAssembly");
    assert.match(item.tooltip, /Publish bin\/MyAssembly\.dll to dev/);
    assert.ok(calls.includes("show"));
  } finally {
    (vscode.window as any).createStatusBarItem = originalCreateStatusBarItem;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
  }
});
