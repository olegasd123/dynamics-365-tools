import * as path from "path";
import type { WorkspaceFilesPort, WorkspaceFileStat } from "@app/ports/files";
import { ConfigurationService } from "../config/configurationService";
import { publishCacheSchema } from "../config/schema";

interface PublishCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

export class PublishCacheService {
  private cache: Record<string, PublishCacheEntry> | undefined;

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly files: WorkspaceFilesPort,
  ) {}

  async isUnchanged(
    remotePath: string,
    stat: WorkspaceFileStat,
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
    stat: WorkspaceFileStat,
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

    const cachePath = this.getCachePath();
    if (!cachePath) {
      return false;
    }

    try {
      await this.ensureVscodeFolder(cachePath);
      const content = await this.files.readFile(cachePath);
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
    const cachePath = this.getCachePath();
    if (!cachePath) {
      return;
    }
    await this.ensureVscodeFolder(cachePath);
    await this.files.writeFile(cachePath, Buffer.from(JSON.stringify(this.cache, null, 2), "utf8"));
  }

  private getCachePath(): string | undefined {
    const root = this.configuration.workspaceRoot;
    if (!root) {
      return undefined;
    }
    return path.join(root, ".vscode", "dynamics365tools.publishCache.json");
  }

  private async ensureVscodeFolder(cachePath: string): Promise<void> {
    const vscodeDir = path.dirname(cachePath);
    if (!(await this.files.exists(vscodeDir))) {
      await this.files.createDirectory(vscodeDir);
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
