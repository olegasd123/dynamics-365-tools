import * as vscode from "vscode";
import type { ClipboardPort } from "../../app/ports/clipboard";

export class VsCodeClipboard implements ClipboardPort {
  async writeText(value: string): Promise<void> {
    await vscode.env.clipboard.writeText(value);
  }
}
