import * as vscode from "vscode";
import type { BindingEntry, EnvironmentConfig } from "../config/domain/models";

export interface LastPublishContext {
  binding: BindingEntry;
  environment: EnvironmentConfig;
  targetUri: vscode.Uri;
  isFolder: boolean;
}

export class WebResourceStatusBarService {
  private readonly item: vscode.StatusBarItem;
  private last?: LastPublishContext;

  constructor(commandId: string) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = commandId;
    this.item.tooltip = "Publish the last web resource again";
    this.item.hide();
  }

  setLastPublish(context: LastPublishContext): void {
    this.last = context;
    this.render();
  }

  getLastPublish(): LastPublishContext | undefined {
    return this.last;
  }

  clear(): void {
    this.last = undefined;
    this.render();
  }

  dispose(): void {
    this.item.dispose();
  }

  private render(): void {
    if (!this.last) {
      this.item.hide();
      return;
    }

    const relative = vscode.workspace.asRelativePath(this.last.targetUri, false);
    const target = this.last.isFolder ? `${relative}/` : relative;
    this.item.text = `$(file-code) ${this.last.environment.name} • ${this.last.binding.solutionName}`;
    this.item.tooltip = `Publish ${target} to ${this.last.environment.name} (${this.last.binding.remotePath})`;
    this.item.show();
  }
}
