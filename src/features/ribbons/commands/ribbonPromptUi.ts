import * as vscode from "vscode";

export function withPaletteFocus<T extends vscode.InputBoxOptions | vscode.QuickPickOptions>(
  options?: T,
): T & { ignoreFocusOut: true } {
  return { ...(options ?? ({} as T)), ignoreFocusOut: true };
}

export function showRibbonInputBox(options: vscode.InputBoxOptions): Thenable<string | undefined> {
  return vscode.window.showInputBox(withPaletteFocus(options));
}

export function showRibbonQuickPick<T extends vscode.QuickPickItem>(
  items: readonly T[] | Thenable<readonly T[]>,
  options: vscode.QuickPickOptions & { canPickMany: true },
): Thenable<T[] | undefined>;
export function showRibbonQuickPick<T extends vscode.QuickPickItem>(
  items: readonly T[] | Thenable<readonly T[]>,
  options?: vscode.QuickPickOptions & { canPickMany?: false },
): Thenable<T | undefined>;
export function showRibbonQuickPick(
  items: readonly string[] | Thenable<readonly string[]>,
  options: vscode.QuickPickOptions & { canPickMany: true },
): Thenable<string[] | undefined>;
export function showRibbonQuickPick(
  items: readonly string[] | Thenable<readonly string[]>,
  options?: vscode.QuickPickOptions & { canPickMany?: false },
): Thenable<string | undefined>;
export function showRibbonQuickPick(
  items:
    | readonly vscode.QuickPickItem[]
    | readonly string[]
    | Thenable<readonly vscode.QuickPickItem[] | readonly string[]>,
  options?: vscode.QuickPickOptions,
): Thenable<vscode.QuickPickItem | vscode.QuickPickItem[] | string | string[] | undefined> {
  return vscode.window.showQuickPick(items as never, withPaletteFocus(options) as never);
}
