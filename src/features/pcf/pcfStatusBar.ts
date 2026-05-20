import * as path from "path";
import * as vscode from "vscode";
import { PcfControlProject } from "./models";

export interface PcfWatchContext {
  project: PcfControlProject;
}

export class PcfStatusBarService implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private watching?: PcfWatchContext;

  constructor(commandId: string) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    this.item.command = commandId;
    this.item.hide();
  }

  setWatching(context: PcfWatchContext): void {
    this.watching = context;
    this.render();
  }

  getWatching(): PcfWatchContext | undefined {
    return this.watching;
  }

  clear(project?: PcfControlProject): void {
    if (project && this.watching?.project.rootUri !== project.rootUri) {
      return;
    }

    this.watching = undefined;
    this.render();
  }

  dispose(): void {
    this.item.dispose();
  }

  private render(): void {
    if (!this.watching) {
      this.item.hide();
      return;
    }

    const name = this.watching.project.constructor || path.basename(this.watching.project.rootUri);
    this.item.text = `$(sync~spin) PCF: ${name} watching`;
    this.item.tooltip = `Stop PCF watch for ${this.watching.project.fullName}`;
    this.item.show();
  }
}
