import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { SolutionPicker } from "../platform/vscode/ui/solutionPicker";

test("pickEnvironment shows error and returns undefined when list is empty", async () => {
  const ui = new SolutionPicker();
  const messages = (vscode.window as any).__messages;
  messages.error.length = 0;

  const env = await ui.pickEnvironment([]);

  assert.strictEqual(env, undefined);
  assert.ok(messages.error[0].includes("No environments configured"));
});

test("pickEnvironment marks default environment as picked", async () => {
  const ui = new SolutionPicker();
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
  const ui = new SolutionPicker();
  const originalQuickPick = (vscode.window as any).showQuickPick;
  let receivedItems: any[] | undefined;
  (vscode.window as any).showQuickPick = async (items: any[]) => {
    receivedItems = items;
    return items.find((item) => item.solution?.name === "Feature");
  };

  try {
    const solution = await ui.promptSolution([
      { name: "Core", prefix: "new_" },
      { name: "Feature", prefix: "feat_" },
    ]);

    assert.strictEqual(solution?.name, "Feature");
    assert.strictEqual(receivedItems?.[0].label, "Core");
    assert.strictEqual(receivedItems?.[1].label, "Feature");
    assert.ok(receivedItems?.some((item) => item.label === "Default solution"));
    assert.strictEqual(receivedItems?.[receivedItems.length - 1].label, "Other solution…");
  } finally {
    (vscode.window as any).showQuickPick = originalQuickPick;
  }
});

test("promptSolution allows selecting the default solution when none configured", async () => {
  const ui = new SolutionPicker();
  const originalInputBox = (vscode.window as any).showInputBox;
  const originalQuickPick = (vscode.window as any).showQuickPick;
  let receivedItems: any[] | undefined;
  (vscode.window as any).showQuickPick = async (items: any[]) => {
    receivedItems = items;
    return items.find((item) => item.label === "Default solution");
  };

  try {
    const solution = await ui.promptSolution([]);

    assert.deepStrictEqual(solution, {
      name: "Default",
      prefix: "new_",
    });
    assert.strictEqual(receivedItems?.[0].label, "Default solution");
  } finally {
    (vscode.window as any).showQuickPick = originalQuickPick;
    (vscode.window as any).showInputBox = originalInputBox;
  }
});

test("promptSolution lets user enter a custom solution via quick pick", async () => {
  const ui = new SolutionPicker();
  const originalInputBox = (vscode.window as any).showInputBox;
  const originalQuickPick = (vscode.window as any).showQuickPick;
  (vscode.window as any).showInputBox = async () => "EnteredSolution";
  (vscode.window as any).showQuickPick = async (items: any[]) =>
    items.find((item) => item.manualEntry);

  try {
    const solution = await ui.promptSolution([]);

    assert.deepStrictEqual(solution, {
      name: "EnteredSolution",
      prefix: "",
    });
  } finally {
    (vscode.window as any).showQuickPick = originalQuickPick;
    (vscode.window as any).showInputBox = originalInputBox;
  }
});
