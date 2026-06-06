import * as vscode from "vscode";
import type { QuickPickOptions, TextInputOptions, TextInputPort } from "../../app/ports/input";

export class VsCodeTextInput implements TextInputPort {
  async showInputBox(options: TextInputOptions): Promise<string | undefined> {
    return vscode.window.showInputBox(options);
  }

  async showQuickPick<T extends { label: string }>(
    items: readonly T[],
    options?: QuickPickOptions,
  ): Promise<T | undefined> {
    return vscode.window.showQuickPick(items as readonly (vscode.QuickPickItem & T)[], options);
  }
}
