import * as vscode from "vscode";
import type { FsPathTarget } from "../../app/ports/files";
import type { EnvironmentConfig } from "../config/domain/models";

export interface LastAssemblyPublishContext {
  assemblyId: string;
  assemblyName?: string;
  environment: EnvironmentConfig;
  assemblyUri: FsPathTarget;
}

export class PluginAssemblyStatusBarService {
  private readonly item: vscode.StatusBarItem;
  private last?: LastAssemblyPublishContext;

  constructor(commandId: string) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.item.command = commandId;
    this.item.tooltip = "Publish the last plugin assembly again";
    this.item.hide();
  }

  setLastPublish(context: LastAssemblyPublishContext): void {
    this.last = context;
    this.render();
  }

  getLastPublish(): LastAssemblyPublishContext | undefined {
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

    const relative = vscode.workspace.asRelativePath(
      vscode.Uri.file(this.last.assemblyUri.fsPath),
      false,
    );
    const assemblyName = this.last.assemblyName ?? "assembly";
    this.item.text = `$(package) ${this.last.environment.name} • ${assemblyName}`;
    this.item.tooltip = `Publish ${relative} to ${this.last.environment.name}`;
    this.item.show();
  }
}
