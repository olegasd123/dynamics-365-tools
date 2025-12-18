import * as vscode from "vscode";
import * as path from "path";
import { BindingEntry, BindingSnapshot } from "../../types";
import { ConfigurationService } from "../config/configurationService";

export class BindingService {
  constructor(private readonly config: ConfigurationService) {}

  async getBinding(uri: vscode.Uri): Promise<BindingEntry | undefined> {
    const snapshot = await this.config.loadBindings();
    const targetPath = path.normalize(uri.fsPath);
    const matches = snapshot.bindings.filter((binding) => this.pathMatches(binding, targetPath));

    // Prefer the most specific path (longest relativeLocalPath)
    return matches.sort((a, b) => b.relativeLocalPath.length - a.relativeLocalPath.length)[0];
  }

  async addOrUpdateBinding(entry: BindingEntry): Promise<void> {
    const snapshot = await this.config.loadBindings();
    const normalized = this.config.createBinding(entry);
    const existingIndex = snapshot.bindings.findIndex(
      (binding) => path.normalize(binding.relativeLocalPath) === normalized.relativeLocalPath,
    );

    if (existingIndex >= 0) {
      snapshot.bindings[existingIndex] = normalized;
    } else {
      snapshot.bindings.push(normalized);
    }

    await this.config.saveBindings(snapshot);
  }

  async listBindings(): Promise<BindingSnapshot> {
    return this.config.loadBindings();
  }

  private pathMatches(binding: BindingEntry, targetPath: string): boolean {
    const bindingPath = this.config.resolveLocalPath(binding.relativeLocalPath);
    if (binding.kind === "file") {
      return bindingPath === targetPath;
    }

    return targetPath === bindingPath || targetPath.startsWith(bindingPath + path.sep);
  }
}
