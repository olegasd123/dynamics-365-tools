import * as vscode from "vscode";
import type { TextInputOptions, TextInputPort } from "../../app/ports/input";

export class VsCodeTextInput implements TextInputPort {
  async showInputBox(options: TextInputOptions): Promise<string | undefined> {
    return vscode.window.showInputBox(options);
  }
}
