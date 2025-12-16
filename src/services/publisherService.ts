import * as vscode from "vscode";
import * as path from "path";
import { BindingEntry, DEFAULT_SOLUTION_NAME, EnvironmentConfig } from "../types";
import { EnvironmentCredentials } from "./secretService";
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

export interface PublishAuth {
  accessToken?: string;
  credentials?: EnvironmentCredentials;
}

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

export class PublisherService {
  private readonly output: vscode.OutputChannel;
  // CRM backend rejects concurrent PublishXml calls; serialize them with a queue.
  private publishQueue: Promise<void> = Promise.resolve();

  constructor() {
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
    const userAgent = this.buildUserAgent(env);
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
      const token = await this.resolveToken(env, auth, shouldLogHeader, userAgent);
      if (!token) {
        throw new Error(
          "No credentials available. Sign in interactively or set client credentials first.",
        );
      }

      const apiRoot = this.apiRoot(env.url);
      this.throwIfCancelled(cancellationToken);
      const { existingId, solutionId } = await this.preflight(
        apiRoot,
        token,
        binding.solutionName,
        remotePath,
        userAgent,
      );
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
        resourceId = await this.updateWebResource(
          apiRoot,
          token,
          existingId,
          {
            content: encoded,
            displayName,
            name: remotePath,
            type: webResourceType,
          },
          userAgent,
        );
        this.output.appendLine(`  ✓ ${fmt.resource(remotePath)} has been updated, publishing...`);
        result.updated = 1;
      } else {
        resourceId = await this.createWebResource(
          apiRoot,
          token,
          {
            content: encoded,
            displayName,
            name: remotePath,
            type: webResourceType,
          },
          userAgent,
        );
        this.output.appendLine(`  ✓ ${fmt.resource(remotePath)} has been created`);
        await this.addToSolution(
          apiRoot,
          token,
          resourceId,
          binding.solutionName,
          solutionId,
          userAgent,
        );
        result.created = 1;
      }

      await this.publishSerial(
        apiRoot,
        token,
        resourceId,
        remotePath,
        cancellationToken,
        userAgent,
      );
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

  async resolveToken(
    env: EnvironmentConfig,
    auth: PublishAuth,
    logAuth: boolean,
    userAgent?: string,
  ): Promise<string | undefined> {
    const resolvedUserAgent = userAgent ?? this.buildUserAgent(env);
    if (auth.credentials) {
      if (logAuth) {
        this.output.appendLine("  ↳ auth: client credentials");
      }
      if (auth.accessToken) {
        return auth.accessToken;
      }
      return this.acquireTokenWithClientCredentials(env, auth.credentials, resolvedUserAgent);
    }

    if (auth.accessToken) {
      if (logAuth) {
        this.output.appendLine("  ↳ auth: interactive token");
      }
      return auth.accessToken;
    }

    return undefined;
  }

  private apiRoot(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/+$/, "");
    return `${trimmed}/api/data/v9.2`;
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
    apiRoot: string,
    token: string,
    solutionName: string,
    remotePath: string,
    userAgent?: string,
  ): Promise<{ solutionId?: string; existingId?: string }> {
    const [solutionId, resources] = await Promise.all([
      this.getSolutionId(apiRoot, token, solutionName, userAgent),
      this.listWebResources(apiRoot, token, remotePath, userAgent),
    ]);

    if (!solutionId && !this.isDefaultSolution(solutionName)) {
      throw new Error(`Solution ${solutionName} not found.`);
    }

    if (resources.length > 1) {
      throw new Error(
        `Multiple web resources found for ${fmt.resource(remotePath)}; resolve duplicates before publishing.`,
      );
    }

    return { solutionId, existingId: resources[0]?.webresourceid };
  }

  private async listWebResources(
    apiRoot: string,
    token: string,
    remotePath: string,
    userAgent?: string,
  ): Promise<Array<{ webresourceid: string }>> {
    const escapedName = remotePath.replace(/'/g, "''");
    const filter = encodeURIComponent(`name eq '${escapedName}'`);
    const url = `${apiRoot}/webresourceset?$select=webresourceid,name&$filter=${filter}&$top=2`;
    const response = await fetch(url, {
      headers: {
        ...this.withUserAgent(
          {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          userAgent,
        ),
      },
    });

    if (!response.ok) {
      throw await this.buildError("Failed to look up web resource", response);
    }

    const body = (await response.json()) as {
      value?: Array<{ webresourceid: string }>;
    };
    return body.value ?? [];
  }

  private async updateWebResource(
    apiRoot: string,
    token: string,
    id: string,
    payload: { content: string; displayName: string; name: string; type: number },
    userAgent?: string,
  ): Promise<string> {
    const url = `${apiRoot}/webresourceset(${id})`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        ...this.withUserAgent(
          {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          userAgent,
        ),
      },
      body: JSON.stringify({
        content: payload.content,
        displayname: payload.displayName,
        name: payload.name,
        webresourcetype: payload.type,
      }),
    });

    if (!response.ok) {
      throw await this.buildError("Failed to update web resource", response);
    }

    return id;
  }

  private async createWebResource(
    apiRoot: string,
    token: string,
    payload: { content: string; displayName: string; name: string; type: number },
    userAgent?: string,
  ): Promise<string> {
    const url = `${apiRoot}/webresourceset`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.withUserAgent(
          {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          userAgent,
        ),
      },
      body: JSON.stringify({
        content: payload.content,
        displayname: payload.displayName,
        name: payload.name,
        webresourcetype: payload.type,
      }),
    });

    if (!response.ok) {
      throw await this.buildError("Failed to create web resource", response);
    }

    const body = (await this.parseJsonIfAny(response)) as {
      webresourceid?: string;
    };
    const id =
      body.webresourceid ||
      this.extractGuid(response.headers.get("OData-EntityId")) ||
      this.extractGuid(response.headers.get("odata-entityid"));

    if (!id) {
      throw new Error("Web resource created but no identifier returned.");
    }

    return id;
  }

  private extractGuid(entityIdHeader: string | null): string | undefined {
    if (!entityIdHeader) {
      return undefined;
    }
    const match = entityIdHeader.match(/[0-9a-fA-F-]{36}/);
    return match?.[0];
  }

  private async addToSolution(
    apiRoot: string,
    token: string,
    componentId: string,
    solutionName: string,
    solutionId?: string,
    userAgent?: string,
  ): Promise<void> {
    if (this.isDefaultSolution(solutionName)) {
      this.output.appendLine("  ↷ skipping solution add for default solution");
      return;
    }

    const targetSolutionId =
      solutionId ?? (await this.getSolutionId(apiRoot, token, solutionName, userAgent));
    if (!targetSolutionId) {
      throw new Error(`Solution ${solutionName} not found.`);
    }

    const alreadyInSolution = await this.isComponentInSolution(
      apiRoot,
      token,
      componentId,
      targetSolutionId,
      userAgent,
    );

    if (alreadyInSolution) {
      return;
    }

    const url = `${apiRoot}/AddSolutionComponent`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.withUserAgent(
          {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          userAgent,
        ),
      },
      body: JSON.stringify({
        ComponentId: componentId,
        ComponentType: 61, // WebResource
        SolutionUniqueName: solutionName,
        AddRequiredComponents: false,
      }),
    });

    if (!response.ok) {
      throw await this.buildError(`Failed to add to solution ${solutionName}`, response);
    }

    this.output.appendLine(`  ✓ added to solution ${fmt.solution(solutionName)}`);
  }

  private async getSolutionId(
    apiRoot: string,
    token: string,
    solutionName: string,
    userAgent?: string,
  ): Promise<string | undefined> {
    const filter = encodeURIComponent(`uniquename eq '${solutionName.replace(/'/g, "''")}'`);
    const url = `${apiRoot}/solutions?$select=solutionid,uniquename&$filter=${filter}`;
    const response = await fetch(url, {
      headers: {
        ...this.withUserAgent(
          {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          userAgent,
        ),
      },
    });

    if (!response.ok) {
      throw await this.buildError("Failed to look up solution", response);
    }

    const body = (await this.parseJsonIfAny(response)) as {
      value?: Array<{ solutionid?: string; uniquename?: string }>;
    };
    return body.value?.[0]?.solutionid;
  }

  private async isComponentInSolution(
    apiRoot: string,
    token: string,
    componentId: string,
    solutionId: string,
    userAgent?: string,
  ): Promise<boolean> {
    const normalizedComponentId = this.trimGuid(componentId);
    const normalizedSolutionId = this.trimGuid(solutionId);
    const filter = encodeURIComponent(
      `componenttype eq 61 and objectid eq ${normalizedComponentId} and _solutionid_value eq ${normalizedSolutionId}`,
    );
    const url = `${apiRoot}/solutioncomponents?$select=solutioncomponentid&$filter=${filter}&$top=1`;
    const response = await fetch(url, {
      headers: {
        ...this.withUserAgent(
          {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          userAgent,
        ),
      },
    });

    if (!response.ok) {
      throw await this.buildError("Failed to verify solution membership", response);
    }

    const body = (await this.parseJsonIfAny(response)) as {
      value?: Array<{ solutioncomponentid?: string }>;
    };
    return Boolean(body.value?.length);
  }

  private trimGuid(value: string): string {
    return value.replace(/[{}]/g, "");
  }

  private isDefaultSolution(solutionName: string): boolean {
    return solutionName.trim().toLowerCase() === DEFAULT_SOLUTION_NAME.toLowerCase();
  }

  private async publishWebResource(
    apiRoot: string,
    token: string,
    webResourceId: string,
    cancellationToken?: vscode.CancellationToken,
    userAgent?: string,
  ): Promise<void> {
    this.throwIfCancelled(cancellationToken);
    const url = `${apiRoot}/PublishXml`;
    const parameterXml = `<importexportxml><webresources><webresource>${webResourceId}</webresource></webresources></importexportxml>`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.withUserAgent(
          {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          userAgent,
        ),
      },
      body: JSON.stringify({ ParameterXml: parameterXml }),
    });

    if (!response.ok) {
      throw await this.buildError("Failed to publish web resource", response);
    }
  }

  private async publishSerial(
    apiRoot: string,
    token: string,
    webResourceId: string,
    remotePath: string,
    cancellationToken?: vscode.CancellationToken,
    userAgent?: string,
  ): Promise<void> {
    const run = async () => {
      this.throwIfCancelled(cancellationToken);
      await this.publishWebResource(apiRoot, token, webResourceId, cancellationToken, userAgent);
      this.output.appendLine(`  ✓ ${fmt.resource(remotePath)} has been published`);
    };

    const next = this.publishQueue.catch(() => undefined).then(run);
    this.publishQueue = next.catch(() => undefined);
    await next;
  }

  private async parseJsonIfAny(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text.trim()) {
      return {};
    }
    return JSON.parse(text);
  }

  private async acquireTokenWithClientCredentials(
    env: EnvironmentConfig,
    credentials: EnvironmentCredentials,
    userAgent?: string,
  ): Promise<string> {
    const tenantId = credentials.tenantId || "organizations";
    const resource = (env.resource || env.url).replace(/\/$/, "");
    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.withUserAgent(
          {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          userAgent,
        ),
      },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        scope: `${resource}/.default`,
        grant_type: "client_credentials",
      }),
    });

    if (!response.ok) {
      throw await this.buildError("Failed to acquire client credentials token", response);
    }

    const body = (await response.json()) as { access_token?: string };
    if (!body.access_token) {
      throw new Error("Token endpoint returned no access token.");
    }

    return body.access_token;
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

  private async buildError(context: string, response: Response): Promise<Error> {
    const text = await response.text();
    let detail = text;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(text) as {
        error?: {
          code?: string;
          message?: string;
          description?: string;
          innererror?: { message?: string; type?: string; stacktrace?: string };
        };
        Message?: string;
      };
      code = parsed.error?.code;
      detail =
        parsed.error?.message ||
        parsed.error?.description ||
        parsed.error?.innererror?.message ||
        parsed.error?.description ||
        parsed.Message ||
        text;
    } catch {
      // Ignore parse errors.
    }

    const correlationId = this.extractCorrelationId(response);
    const message = code && detail !== code ? `${code}: ${detail}` : detail;

    const error = new Error(`${context}: ${message} (${response.status})`) as Error & {
      code?: string;
      correlationId?: string;
      rawBody?: string;
      status?: number;
    };
    error.code = code;
    error.correlationId = correlationId;
    error.rawBody = text;
    error.status = response.status;

    return error;
  }

  private extractCorrelationId(response: Response): string | undefined {
    const headers = response.headers;
    const direct =
      headers.get("x-ms-correlation-request-id") ||
      headers.get("x-ms-request-id") ||
      headers.get("request-id");
    if (direct) {
      return direct;
    }

    const diagnostics = headers.get("x-ms-diagnostics") || headers.get("x-ms-ags-diagnostic");
    if (!diagnostics) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(diagnostics) as { ServerResponseId?: string };
      return parsed.ServerResponseId;
    } catch {
      return undefined;
    }
  }

  private withUserAgent<T extends Record<string, string>>(
    headers: T,
    userAgent?: string,
  ): T & { "User-Agent"?: string } {
    if (!userAgent) {
      return headers;
    }
    return { ...headers, "User-Agent": userAgent };
  }

  private buildUserAgent(env: EnvironmentConfig): string | undefined {
    if (!env.userAgentEnabled) {
      return undefined;
    }
    if (env.userAgent?.trim()) {
      return env.userAgent.trim();
    }
    const extension = vscode.extensions.getExtension("dynamics365tools.dynamics-365-tools");
    const version = (extension?.packageJSON as { version?: string })?.version || "dev";
    return `Dynamics365Tools-VSCode/${version}`;
  }
}
