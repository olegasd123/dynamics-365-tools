import * as vscode from "vscode";
import * as path from "path";
import { BindingEntry, EnvironmentConfig } from "../../types";
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
  cancellationToken?: vscode.CancellationToken;
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
  private readonly output: vscode.OutputChannel;
  // CRM backend rejects concurrent PublishXml calls; serialize them with a queue.
  private publishQueue: Promise<void> = Promise.resolve();

  constructor(private readonly connections: EnvironmentConnectionService) {
    this.output = vscode.window.createOutputChannel("Dynamics 365 Tools Publisher");
  }

  async publish(
    binding: BindingEntry,
    env: EnvironmentConfig,
    auth: PublishAuth = {},
    targetUri?: vscode.Uri,
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
      const fileStat = await vscode.workspace.fs.stat(vscode.Uri.file(localPath));
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
      const connection = await this.connections.createConnection(env, auth);
      if (!connection) {
        throw new Error(
          "No credentials available. Sign in interactively or set client credentials first.",
        );
      }

      const client = new DataverseClient(connection);
      const solutionComponents = new SolutionComponentService(client);

      this.throwIfCancelled(cancellationToken);
      const { existingId } = await this.preflight(client, binding.solutionName, remotePath);
      content = content ?? (await this.readFile(localPath));
      const encoded = content.toString("base64");
      hash = hash ?? this.hashContent(content);
      const webResourceType = this.detectType(localPath);
      const displayName = path.posix.basename(remotePath);

      this.output.appendLine(`  ${fmt.resource(remotePath)} ← ${localPath}`);
      const allowCreate = env.createMissingComponents === true;

      if (!existingId && !allowCreate) {
        this.output.appendLine(
          `  ✗ Resource does not exist and creation is disabled for ${fmt.env(env.name)}`,
        );
        result.skipped = 1;
        return result;
      }

      let resourceId: string;
      if (existingId) {
        resourceId = await this.updateWebResource(client, existingId, {
          content: encoded,
          displayName,
          name: remotePath,
          type: webResourceType,
        });
        this.output.appendLine(`  ✓ ${fmt.resource(remotePath)} has been updated, publishing...`);
        result.updated = 1;
      } else {
        resourceId = await this.createWebResource(client, {
          content: encoded,
          displayName,
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
          vscode.window.showWarningMessage(
            `Dynamics 365 Tools publish to ${envName}: ${cancelled ? "cancelled, " : ""}${summary} (check output for errors)`,
          );
        } else {
          vscode.window.showInformationMessage(
            `Dynamics 365 Tools publish to ${envName}: ${summary}`,
          );
        }
      }
    }
  }

  private async resolvePaths(
    binding: BindingEntry,
    targetUri?: vscode.Uri,
  ): Promise<{ localPath: string; remotePath: string }> {
    const bindingRoot = this.resolveLocalPath(binding.relativeLocalPath);
    const targetPath = targetUri?.fsPath ?? bindingRoot;
    const targetStat = await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
    if (targetStat.type === vscode.FileType.Directory) {
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

    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
    const uri = vscode.Uri.file(localPath);
    return Buffer.from(await vscode.workspace.fs.readFile(uri));
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
      case ".resx":
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
        return 10;
      case ".ico":
        return 11;
      case ".svg":
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
    payload: { content: string; displayName: string; name: string; type: number },
  ): Promise<string> {
    await client.patch(`/webresourceset(${id})`, {
      content: payload.content,
      displayname: payload.displayName,
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
    cancellationToken?: vscode.CancellationToken,
  ): Promise<void> {
    this.throwIfCancelled(cancellationToken);
    const parameterXml = `<importexportxml><webresources><webresource>${webResourceId}</webresource></webresources></importexportxml>`;
    await client.post(`/PublishXml`, { ParameterXml: parameterXml });
  }

  private async publishSerial(
    client: DataverseClient,
    webResourceId: string,
    remotePath: string,
    cancellationToken?: vscode.CancellationToken,
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

  private throwIfCancelled(token?: vscode.CancellationToken): void {
    if (this.isCancelled(token)) {
      const error = new Error("Publish cancelled");
      (error as any).cancelled = true;
      throw error;
    }
  }

  private isCancelled(token?: vscode.CancellationToken): boolean {
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
    const selection = await vscode.window.showErrorMessage(
      `Dynamics 365 Tools publish failed: ${message}`,
      copyAction,
    );
    if (selection !== copyAction) {
      return;
    }

    const details = this.formatErrorDetails(error);
    try {
      await vscode.env.clipboard.writeText(details);
      this.output.appendLine("  ↳ Error details copied to clipboard");
    } catch {
      // Clipboard failures should not crash publish flow.
    }
  }

  private formatErrorDetails(error: unknown): string {
    const base = error instanceof Error ? error.message : String(error);
    const code = (error as any)?.code as string | undefined;
    const correlationId = (error as any)?.correlationId as string | undefined;
    const status = (error as any)?.status as number | undefined;
    const rawBody = (error as any)?.rawBody as string | undefined;
    const sections = [
      `Message: ${base}`,
      code ? `Code: ${code}` : undefined,
      status ? `Status: ${status}` : undefined,
      correlationId ? `CorrelationId: ${correlationId}` : undefined,
      rawBody ? `Response: ${rawBody}` : undefined,
    ].filter(Boolean);
    return sections.join("\n");
  }
}
