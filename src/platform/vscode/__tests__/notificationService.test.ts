import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { VsCodeNotificationService } from "../notificationService";

test("passive notifications do not wait for VS Code message dismissal", async () => {
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  let shownMessage = "";

  (vscode.window as any).showInformationMessage = (message: string) => {
    shownMessage = message;
    return new Promise(() => undefined);
  };

  try {
    let completed = false;
    void new VsCodeNotificationService().info("Assembly updated.").then(() => {
      completed = true;
    });

    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(shownMessage, "Assembly updated.");
    assert.strictEqual(completed, true);
  } finally {
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
  }
});

test("question notifications still wait for VS Code selection", async () => {
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  let resolveSelection: ((value: string | undefined) => void) | undefined;

  (vscode.window as any).showInformationMessage = () =>
    new Promise<string | undefined>((resolve) => {
      resolveSelection = resolve;
    });

  try {
    let completed = false;
    const selection = new VsCodeNotificationService()
      .askInfo("Open details?", ["Open"])
      .then((value) => {
        completed = true;
        return value;
      });

    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(completed, false);

    resolveSelection?.("Open");
    assert.strictEqual(await selection, "Open");
    assert.strictEqual(completed, true);
  } finally {
    (vscode.window as any).showInformationMessage = originalShowInformationMessage;
  }
});
