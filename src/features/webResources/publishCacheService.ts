import * as vscode from "vscode";
import * as path from "path";
import { ConfigurationService } from "../config/configurationService";
import { publishCacheSchema } from "../config/schema";

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
    environment?: string,
  ): Promise<boolean> {
    if (!(await this.ensureLoaded())) {
      return false;
    }
    const key = this.normalizeKey(remotePath, environment);
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
    environment?: string,
  ): Promise<void> {
    if (!(await this.ensureLoaded())) {
      return;
    }
    const key = this.normalizeKey(remotePath, environment);
    this.cache![key] = {
      mtime: stat.mtime,
      size: stat.size,
      hash,
    };
    await this.save();
  }

  private normalizeKey(remotePath: string, environment?: string): string {
    const envKey = (environment || "default").toLowerCase();
    return `${envKey}::${remotePath.replace(/\\/g, "/")}`;
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
      this.cache = publishCacheSchema.parse(
        this.parseJson(content, "dynamics365tools.publishCache.json"),
      ) as Record<string, PublishCacheEntry>;
    } catch (error) {
      this.cache = {};
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to read publish cache: ${message}`);
      }
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
    return vscode.Uri.joinPath(workspaceUri, ".vscode", "dynamics365tools.publishCache.json");
  }

  private async ensureVscodeFolder(cacheUri: vscode.Uri): Promise<void> {
    const vscodeDir = vscode.Uri.file(path.dirname(cacheUri.fsPath));
    try {
      await vscode.workspace.fs.stat(vscodeDir);
    } catch {
      await vscode.workspace.fs.createDirectory(vscodeDir);
    }
  }

  private parseJson(content: Uint8Array, filename: string): unknown {
    try {
      return JSON.parse(content.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${filename} contains invalid JSON: ${message}`);
    }
  }
}
