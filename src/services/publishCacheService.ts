import * as vscode from "vscode";
import * as path from "path";
import { ConfigurationService } from "./configurationService";

interface PublishCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

export class PublishCacheService {
  private cache: Record<string, PublishCacheEntry> | undefined;

  constructor(private readonly configuration: ConfigurationService) {}

  async isUnchanged(
    remotePath: string,
    stat: vscode.FileStat,
    hash: string,
  ): Promise<boolean> {
    if (!(await this.ensureLoaded())) {
      return false;
    }
    const key = this.normalizeKey(remotePath);
    const entry = this.cache?.[key];
    if (!entry || entry.hash !== hash) {
      return false;
    }

    // Content matches; refresh metadata if the watcher touched mtime/size.
    if (entry.mtime !== stat.mtime || entry.size !== stat.size) {
      this.cache![key] = {
        mtime: stat.mtime,
        size: stat.size,
        hash,
      };
      await this.save();
    }

    return true;
  }

  async update(
    remotePath: string,
    stat: vscode.FileStat,
    hash: string,
  ): Promise<void> {
    if (!(await this.ensureLoaded())) {
      return;
    }
    const key = this.normalizeKey(remotePath);
    this.cache![key] = {
      mtime: stat.mtime,
      size: stat.size,
      hash,
    };
    await this.save();
  }

  private normalizeKey(remotePath: string): string {
    return remotePath.replace(/\\/g, "/");
  }

  private async ensureLoaded(): Promise<boolean> {
    if (this.cache) {
      return true;
    }

    const cacheUri = await this.getCacheUri();
    if (!cacheUri) {
      return false;
    }

    try {
      await this.ensureVscodeFolder(cacheUri);
      const content = await vscode.workspace.fs.readFile(cacheUri);
      this.cache = JSON.parse(content.toString()) as Record<
        string,
        PublishCacheEntry
      >;
    } catch {
      this.cache = {};
    }

    return true;
  }

  private async save(): Promise<void> {
    const cacheUri = await this.getCacheUri();
    if (!cacheUri) {
      return;
    }
    await this.ensureVscodeFolder(cacheUri);
    await vscode.workspace.fs.writeFile(
      cacheUri,
      Buffer.from(JSON.stringify(this.cache, null, 2), "utf8"),
    );
  }

  private async getCacheUri(): Promise<vscode.Uri | undefined> {
    const root = this.configuration.workspaceRoot;
    if (!root) {
      return undefined;
    }
    const workspaceUri = vscode.Uri.file(root);
    return vscode.Uri.joinPath(workspaceUri, ".vscode", "xrm.publishCache.json");
  }

  private async ensureVscodeFolder(cacheUri: vscode.Uri): Promise<void> {
    const vscodeDir = vscode.Uri.file(path.dirname(cacheUri.fsPath));
    try {
      await vscode.workspace.fs.stat(vscodeDir);
    } catch {
      await vscode.workspace.fs.createDirectory(vscodeDir);
    }
  }
}
