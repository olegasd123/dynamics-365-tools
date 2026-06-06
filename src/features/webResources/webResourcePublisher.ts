import * as path from "path";
import { ClipboardPort, NoopClipboard } from "../../app/ports/clipboard";
import { WorkspaceFilesPort, WorkspaceFileType, type FsPathTarget } from "../../app/ports/files";
import { NoopNotificationService, NotificationPort } from "../../app/ports/notifications";
import { NoopOutputPort, OutputChannelPort, OutputPort } from "../../app/ports/output";
import type { CancellationTokenLike } from "../../app/ports/progress";
import { formatErrorDetails } from "../../shared/errorDetails";
import { BindingEntry, EnvironmentConfig } from "../config/domain/models";
import { DataverseClient, isDefaultSolution } from "../dataverse/dataverseClient";
import {
  EnvironmentAuthContext,
  EnvironmentConnectionService,
} from "../dataverse/environmentConnectionService";
import {
  SolutionComponentService,
  SolutionComponentType,
} from "../dataverse/solutionComponentService";
import { PublishCacheService } from "./publishCacheService";
import * as crypto from "crypto";

// Formatting helpers for OutputChannel (plain text)
const fmt = {
  remote: (s: string) => `[${s}]`,
  resource: (s: string) => `${s}`,
  env: (s: string) => `「 ${s} 」`,
  url: (s: string) => `<${s}>`,
  path: (s: string) => s,
  solution: (s: string) => `[${s}]`,
};

export type PublishAuth = EnvironmentAuthContext;

export interface PublishOptions {
  isFirst?: boolean;
  /** Optional cache used to skip unchanged files during folder publish. */
  cache?: PublishCacheService;
  cancellationToken?: CancellationTokenLike;
}

export interface PublishResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  /** True when publish exited early due to cancellation. */
  cancelled?: boolean;
}

export class WebResourcePublisher {
  private readonly output: OutputChannelPort;
  // CRM backend rejects concurrent PublishXml calls; serialize them with a queue.
  private publishQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly connections: EnvironmentConnectionService,
    private readonly files: WorkspaceFilesPort,
    private readonly notifications: NotificationPort = new NoopNotificationService(),
    output: OutputPort = new NoopOutputPort(),
    private readonly clipboard: ClipboardPort = new NoopClipboard(),
  ) {
    this.output = output.createChannel("Dynamics 365 Tools Publisher");
  }

  async publish(
    binding: BindingEntry,
    env: EnvironmentConfig,
    auth: PublishAuth = {},
    targetUri?: FsPathTarget,
    options: PublishOptions = {},
  ): Promise<PublishResult> {
    const result: PublishResult = { created: 0, updated: 0, skipped: 0, failed: 0 };
    const cancellationToken = options.cancellationToken;
    const shouldLogHeader = options.isFirst ?? true;
    const started = new Date().toISOString();
    if (shouldLogHeader) {
      this.output.appendLine(
        "────────────────────────────────────────────────────────────────────",
      );
      this.output.appendLine(
        `[${started}] Publishing ${fmt.remote(binding.remotePath)} → ${fmt.env(env.name)} ${fmt.url(env.url)}`,
      );
      this.output.show(true);
    }

    try {
      this.throwIfCancelled(cancellationToken);
      const { localPath, remotePath } = await this.resolvePaths(binding, targetUri);
      const fileStat = await this.files.stat(localPath);
      let content: Buffer | undefined;
      let hash: string | undefined;

      if (options.cache) {
        content = await this.readFile(localPath);
        hash = this.hashContent(content);
        if (await options.cache.isUnchanged(remotePath, fileStat, hash, env.name)) {
          this.output.appendLine(`  ↷ ${fmt.resource(remotePath)} has been skipped (unchanged)`);
          result.skipped = 1;
          return result;
        }
      }

      this.throwIfCancelled(cancellationToken);
      const client = await this.connections.createClient(env, auth);
      if (!client) {
        throw new Error(
          "No credentials available. Sign in interactively or set client credentials first.",
        );
      }

      const solutionComponents = new SolutionComponentService(client);

      this.throwIfCancelled(cancellationToken);
      const { existingId } = await this.preflight(client, binding.solutionName, remotePath);
      content = content ?? (await this.readFile(localPath));
      const encoded = content.toString("base64");
      hash = hash ?? this.hashContent(content);
      const webResourceType = this.detectType(localPath);

      this.output.appendLine(`  ${fmt.resource(remotePath)} ← ${localPath}`);
      const canManageMissing = env.manageMissingComponents === true;

      if (!existingId && !canManageMissing) {
        this.output.appendLine(
          `  ✗ Resource does not exist and missing component management is disabled for ${fmt.env(env.name)}`,
        );
        result.skipped = 1;
        return result;
      }

      let resourceId: string;
      if (existingId) {
        resourceId = await this.updateWebResource(client, existingId, {
          content: encoded,
          name: remotePath,
          type: webResourceType,
        });
        this.output.appendLine(`  ✓ ${fmt.resource(remotePath)} has been updated, publishing...`);
        result.updated = 1;
      } else {
        resourceId = await this.createWebResource(client, {
          content: encoded,
          displayName: path.posix.basename(remotePath),
          name: remotePath,
          type: webResourceType,
        });
        this.output.appendLine(`  ✓ ${fmt.resource(remotePath)} has been created`);
        await solutionComponents.ensureInSolution(
          resourceId,
          SolutionComponentType.WebResource,
          binding.solutionName,
        );
        result.created = 1;
      }

      await this.publishSerial(client, resourceId, remotePath, cancellationToken);
      if (options.cache && hash) {
        await options.cache.update(remotePath, fileStat, hash, env.name);
      }
    } catch (error) {
      if (this.isCancellationError(error)) {
        result.cancelled = true;
        result.skipped = 1;
        this.output.appendLine(`  ↷ Publish cancelled`);
        return result;
      }
      const message = this.describeError(error);
      this.output.appendLine(`  ✗ Publish failed: ${message}`);
      this.output.show(true);
      await this.notifyError(message, error);
      result.failed = 1;
    }
    return result;
  }

  logSummary(result: PublishResult, envName?: string, cancelled = false): void {
    const parts: string[] = [];
    if (result.created) parts.push(`${result.created} created`);
    if (result.updated) parts.push(`${result.updated} updated`);
    if (result.skipped) parts.push(`${result.skipped} skipped`);
    if (result.failed) parts.push(`${result.failed} failed`);
    if (parts.length) {
      this.output.appendLine(`  ─────`);
      if (cancelled) {
        this.output.appendLine("  ⚠ Publish cancelled; partial results only.");
      }
      this.output.appendLine(`  Total: ${parts.join(", ")}`);
      if (envName) {
        const summary = parts.join(", ");
        if (result.failed || cancelled) {
          void this.notifications.warning(
            `Dynamics 365 Tools publish to ${envName}: ${cancelled ? "cancelled, " : ""}${summary} (check output for errors)`,
          );
        } else {
          void this.notifications.info(`Dynamics 365 Tools publish to ${envName}: ${summary}`);
        }
      }
    }
  }

  private async resolvePaths(
    binding: BindingEntry,
    targetUri?: FsPathTarget,
  ): Promise<{ localPath: string; remotePath: string }> {
    const bindingRoot = this.resolveLocalPath(binding.relativeLocalPath);
    const targetPath = targetUri?.fsPath ?? bindingRoot;
    const targetStat = await this.files.stat(targetPath);
    if (targetStat.type === WorkspaceFileType.Directory) {
      throw new Error("Select a file inside the bound folder to publish.");
    }

    if (binding.kind === "folder") {
      const relative = path.relative(bindingRoot, targetPath);
      if (!relative || relative.startsWith("..")) {
        throw new Error("Selected file is outside the bound folder mapping.");
      }
      return {
        localPath: targetPath,
        remotePath: this.joinRemote(binding.remotePath, relative),
      };
    }

    return {
      localPath: targetPath,
      remotePath: binding.remotePath.replace(/\\/g, "/"),
    };
  }

  private resolveLocalPath(bindingPath: string): string {
    if (path.isAbsolute(bindingPath)) {
      return path.normalize(bindingPath);
    }

    const workspace = this.files.workspaceRoot;
    if (!workspace) {
      throw new Error("No workspace folder detected; cannot resolve binding path.");
    }

    const workspaceName = path.basename(workspace);
    const segments = bindingPath.split(/[/\\]+/);
    if (segments[0] === workspaceName) {
      segments.shift();
    }

    return path.normalize(path.join(workspace, ...segments));
  }

  private joinRemote(base: string, relative: string): string {
    const normalizedBase = base.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalizedRelative = relative.replace(/\\/g, "/");
    return normalizedRelative ? `${normalizedBase}/${normalizedRelative}` : normalizedBase;
  }

  private async readFile(localPath: string): Promise<Buffer> {
    return Buffer.from(await this.files.readFile(localPath));
  }

  private hashContent(content: Buffer): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  private detectType(localPath: string): number {
    const ext = path.extname(localPath).toLowerCase();
    switch (ext) {
      case ".htm":
      case ".html":
        return 1;
      case ".css":
        return 2;
      case ".js":
      case ".ts":
        return 3;
      case ".xml":
      case ".json":
        return 4;
      case ".png":
        return 5;
      case ".jpg":
      case ".jpeg":
        return 6;
      case ".gif":
        return 7;
      case ".xsl":
      case ".xslt":
        return 9;
      case ".ico":
        return 10;
      case ".svg":
        return 11;
      case ".resx":
        return 12;
      default:
        return 3;
    }
  }

  private async preflight(
    client: DataverseClient,
    solutionName: string,
    remotePath: string,
  ): Promise<{ existingId?: string }> {
    const [solutionId, resources] = await Promise.all([
      this.getSolutionId(client, solutionName),
      this.listWebResources(client, remotePath),
    ]);

    if (!solutionId && !isDefaultSolution(solutionName)) {
      throw new Error(`Solution ${solutionName} not found.`);
    }

    if (resources.length > 1) {
      throw new Error(
        `Multiple web resources found for ${fmt.resource(remotePath)}; resolve duplicates before publishing.`,
      );
    }

    return { existingId: resources[0]?.webresourceid };
  }

  private async getSolutionId(
    client: DataverseClient,
    solutionName: string,
  ): Promise<string | undefined> {
    const filter = encodeURIComponent(`uniquename eq '${solutionName.replace(/'/g, "''")}'`);
    const url = `/solutions?$select=solutionid,uniquename&$filter=${filter}&$top=1`;
    const response = await client.get<{ value?: Array<{ solutionid?: string }> }>(url);
    return response.value?.[0]?.solutionid;
  }

  private async listWebResources(
    client: DataverseClient,
    remotePath: string,
  ): Promise<Array<{ webresourceid: string }>> {
    const escapedName = remotePath.replace(/'/g, "''");
    const filter = encodeURIComponent(`name eq '${escapedName}'`);
    const url = `/webresourceset?$select=webresourceid,name&$filter=${filter}&$top=2`;
    const response = await client.get<{ value?: Array<{ webresourceid: string }> }>(url);
    return response.value ?? [];
  }

  private async updateWebResource(
    client: DataverseClient,
    id: string,
    payload: { content: string; name: string; type: number },
  ): Promise<string> {
    await client.patch(`/webresourceset(${id})`, {
      content: payload.content,
      name: payload.name,
      webresourcetype: payload.type,
    });
    return id;
  }

  private async createWebResource(
    client: DataverseClient,
    payload: { content: string; displayName: string; name: string; type: number },
  ): Promise<string> {
    const created = await client.post<{ webresourceid?: string }>(`/webresourceset`, {
      content: payload.content,
      displayname: payload.displayName,
      name: payload.name,
      webresourcetype: payload.type,
    });

    const id = created.webresourceid?.replace(/[{}]/g, "");
    if (!id) {
      throw new Error("Web resource created but no identifier returned.");
    }

    return id;
  }

  private async publishWebResource(
    client: DataverseClient,
    webResourceId: string,
    cancellationToken?: CancellationTokenLike,
  ): Promise<void> {
    this.throwIfCancelled(cancellationToken);
    const parameterXml = `<importexportxml><webresources><webresource>${webResourceId}</webresource></webresources></importexportxml>`;
    await client.post(`/PublishXml`, { ParameterXml: parameterXml });
  }

  private async publishSerial(
    client: DataverseClient,
    webResourceId: string,
    remotePath: string,
    cancellationToken?: CancellationTokenLike,
  ): Promise<void> {
    const run = async () => {
      this.throwIfCancelled(cancellationToken);
      await this.publishWebResource(client, webResourceId, cancellationToken);
      this.output.appendLine(`  ✓ ${fmt.resource(remotePath)} has been published`);
    };

    const next = this.publishQueue.catch(() => undefined).then(run);
    this.publishQueue = next.catch(() => undefined);
    await next;
  }

  private throwIfCancelled(token?: CancellationTokenLike): void {
    if (this.isCancelled(token)) {
      const error = new Error("Publish cancelled");
      (error as any).cancelled = true;
      throw error;
    }
  }

  private isCancelled(token?: CancellationTokenLike): boolean {
    return token?.isCancellationRequested ?? false;
  }

  private isCancellationError(error: unknown): boolean {
    return Boolean((error as any)?.cancelled);
  }

  private describeError(error: unknown): string {
    const base = error instanceof Error ? error.message : String(error);
    const code = (error as any)?.code as string | undefined;
    const correlationId = (error as any)?.correlationId as string | undefined;
    const extras: string[] = [];
    if (code) extras.push(`code ${code}`);
    if (correlationId) extras.push(`corr ${correlationId}`);
    return extras.length ? `${base} (${extras.join(", ")})` : base;
  }

  private async notifyError(message: string, error?: unknown): Promise<void> {
    const copyAction = "Copy error details";
    const selection = await this.notifications.askError(
      `Dynamics 365 Tools publish failed: ${message}`,
      [copyAction],
    );
    if (selection !== copyAction) {
      return;
    }

    const details = formatErrorDetails(error);
    try {
      await this.clipboard.writeText(details);
      this.output.appendLine("  ↳ Error details copied to clipboard");
    } catch {
      // Clipboard failures should not crash publish flow.
    }
  }
}
