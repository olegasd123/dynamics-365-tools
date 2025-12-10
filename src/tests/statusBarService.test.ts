import assert from "node:assert";
import test from "node:test";
import * as path from "path";
import * as vscode from "vscode";
import { StatusBarService } from "../services/statusBarService";

test("setLastPublish renders status bar entry with environment and solution", () => {
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
    const service = new StatusBarService("xrm.publish");
    service.setLastPublish({
      binding: {
        relativeLocalPath: "/workspace/web/script.js",
        remotePath: "new_/web/script.js",
        solutionName: "Core",
        kind: "file",
      },
      environment: { name: "dev", url: "https://example" },
      targetUri: vscode.Uri.file("/workspace/web/script.js"),
      isFolder: false,
    });

    assert.strictEqual(service.getLastPublish()?.environment.name, "dev");
    assert.strictEqual(item.text, "$(cloud-upload) dev • Core");
    assert.match(item.tooltip, /Publish web\/script\.js to dev \(new_\/web\/script\.js\)/);
    assert.ok(calls.includes("show"));
  } finally {
    (vscode.window as any).createStatusBarItem = originalCreateStatusBarItem;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
  }
});

test("clear removes last publish context and hides the status bar item", () => {
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
    const service = new StatusBarService("xrm.publish");
    service.setLastPublish({
      binding: {
        relativeLocalPath: "/workspace/web/script.js",
        remotePath: "new_/web/script.js",
        solutionName: "Core",
        kind: "file",
      },
      environment: { name: "dev", url: "https://example" },
      targetUri: vscode.Uri.file("/workspace/web/script.js"),
      isFolder: false,
    });

    service.clear();

    assert.strictEqual(service.getLastPublish(), undefined);
    assert.ok(calls.includes("hide"));
  } finally {
    (vscode.window as any).createStatusBarItem = originalCreateStatusBarItem;
    (vscode.workspace as any).asRelativePath = originalAsRelativePath;
  }
});
