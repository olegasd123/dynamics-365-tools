import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { UiService } from "../services/uiService";

test("pickEnvironment shows error and returns undefined when list is empty", async () => {
  const ui = new UiService();
  const messages = (vscode.window as any).__messages;
  messages.error.length = 0;

  const env = await ui.pickEnvironment([]);

  assert.strictEqual(env, undefined);
  assert.ok(messages.error[0].includes("No environments configured"));
});

test("pickEnvironment marks default environment as picked", async () => {
  const ui = new UiService();
  const originalQuickPick = (vscode.window as any).showQuickPick;
  let receivedItems: any[] | undefined;
  (vscode.window as any).showQuickPick = async (items: any[]) => {
    receivedItems = items;
    return items[1];
  };

  try {
    const env = await ui.pickEnvironment(
      [
        { name: "dev", url: "https://dev" },
        { name: "test", url: "https://test" },
      ],
      "test",
    );

    assert.strictEqual(env?.name, "test");
    assert.strictEqual(receivedItems?.[0].picked, false);
    assert.strictEqual(receivedItems?.[1].picked, true);
  } finally {
    (vscode.window as any).showQuickPick = originalQuickPick;
  }
});

test("promptSolution uses quick pick when solutions exist", async () => {
  const ui = new UiService();
  const originalQuickPick = (vscode.window as any).showQuickPick;
  let receivedItems: any[] | undefined;
  (vscode.window as any).showQuickPick = async (items: any[]) => {
    receivedItems = items;
    return items[1];
  };

  try {
    const solution = await ui.promptSolution(
      [
        { name: "Core", prefix: "new_", default: true },
        { name: "Feature", prefix: "feat_" },
      ],
      "Core",
    );

    assert.strictEqual(solution?.name, "Feature");
    assert.strictEqual(receivedItems?.[0].picked, true);
    assert.strictEqual(receivedItems?.[1].picked, false);
  } finally {
    (vscode.window as any).showQuickPick = originalQuickPick;
  }
});

test("promptSolution falls back to input box when no solutions configured", async () => {
  const ui = new UiService();
  const originalInputBox = (vscode.window as any).showInputBox;
  (vscode.window as any).showInputBox = async () => "EnteredSolution";

  try {
    const solution = await ui.promptSolution([], "DefaultSolution");

    assert.deepStrictEqual(solution, {
      name: "EnteredSolution",
      prefix: "",
    });
  } finally {
    (vscode.window as any).showInputBox = originalInputBox;
  }
});
