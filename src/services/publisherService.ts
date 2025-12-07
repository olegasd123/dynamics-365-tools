import * as vscode from "vscode";
import * as path from "path";
import { BindingEntry, EnvironmentConfig } from "../types";
import { EnvironmentCredentials } from "./secretService";

export interface PublishAuth {
  accessToken?: string;
  credentials?: EnvironmentCredentials;
}

export interface PublishOptions {
  /** Log the header line with timestamp/resource/env. Defaults to true. */
  logHeader?: boolean;
  /** Log which auth source was used. Defaults to true. */
  logAuth?: boolean;
}

export class PublisherService {
  private readonly output: vscode.OutputChannel;

  constructor() {
    this.output = vscode.window.createOutputChannel("XRM Publisher");
  }

  async publish(
    binding: BindingEntry,
    env: EnvironmentConfig,
    auth: PublishAuth = {},
    targetUri?: vscode.Uri,
    options: PublishOptions = {},
  ): Promise<void> {
    const shouldLogHeader = options.logHeader ?? true;
    const shouldLogAuth = options.logAuth ?? true;
    const started = new Date().toISOString();
    if (shouldLogHeader) {
      this.output.appendLine(
        `[${started}] Publishing ${binding.remotePath} to ${env.name} (${env.url})...`,
      );
      this.output.show(true);
    }

    try {
      const { localPath, remotePath } = await this.resolvePaths(binding, targetUri);
      const token = await this.resolveToken(env, auth, shouldLogAuth);
      if (!token) {
        throw new Error(
          "No credentials available. Sign in interactively or set client credentials first.",
        );
      }

      const apiRoot = this.apiRoot(env.url);
      const content = await this.readFile(localPath);
      const encoded = content.toString("base64");
      const webResourceType = this.detectType(localPath);
      const displayName = path.posix.basename(remotePath);

      this.output.appendLine(`Uploading ${remotePath} from ${localPath}...`);
      const existingId = await this.findWebResource(apiRoot, token, remotePath);
      const allowCreate = env.createMissingWebResources !== false;
      const resourceId = existingId
        ? await this.updateWebResource(apiRoot, token, existingId, {
            content: encoded,
            displayName,
            name: remotePath,
            type: webResourceType,
          })
        : allowCreate
          ? await this.createWebResource(apiRoot, token, {
              content: encoded,
              displayName,
              name: remotePath,
              type: webResourceType,
            })
          : await Promise.reject(
              new Error(
                `Web resource ${remotePath} does not exist and creation is disabled for ${env.name}.`,
              ),
            );

      await this.addToSolution(apiRoot, token, resourceId, binding.solutionName);
      await this.publishWebResource(apiRoot, token, resourceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`Publish failed: ${message}`);
      this.output.show(true);
      vscode.window.showErrorMessage(`XRM publish failed: ${message}`);
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
    return normalizedRelative
      ? `${normalizedBase}/${normalizedRelative}`
      : normalizedBase;
  }

  private async resolveToken(
    env: EnvironmentConfig,
    auth: PublishAuth,
    logAuth: boolean,
  ): Promise<string | undefined> {
    if (auth.accessToken) {
      if (logAuth) {
        this.output.appendLine(
          "Using interactive access token.",
        );
      }
      return auth.accessToken;
    }

    if (auth.credentials) {
      if (logAuth) {
        this.output.appendLine(
          `Using clientId ${auth.credentials.clientId} ${
            auth.credentials.tenantId ? `(tenant ${auth.credentials.tenantId})` : ""
          } from secret storage.`,
        );
      }
      return this.acquireTokenWithClientCredentials(env, auth.credentials);
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
      case ".xap":
        return 8;
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

  private async findWebResource(
    apiRoot: string,
    token: string,
    remotePath: string,
  ): Promise<string | undefined> {
    const escapedName = remotePath.replace(/'/g, "''");
    const filter = encodeURIComponent(`name eq '${escapedName}'`);
    const url = `${apiRoot}/webresourceset?$select=webresourceid,name&$filter=${filter}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw await this.buildError("Failed to look up web resource", response);
    }

    const body = (await response.json()) as {
      value?: Array<{ webresourceid: string }>;
    };
    return body.value?.[0]?.webresourceid;
  }

  private async updateWebResource(
    apiRoot: string,
    token: string,
    id: string,
    payload: { content: string; displayName: string; name: string; type: number },
  ): Promise<string> {
    const url = `${apiRoot}/webresourceset(${id})`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
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

    this.output.appendLine("Updated existing web resource.");
    return id;
  }

  private async createWebResource(
    apiRoot: string,
    token: string,
    payload: { content: string; displayName: string; name: string; type: number },
  ): Promise<string> {
    const url = `${apiRoot}/webresourceset`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
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

    this.output.appendLine("Created new web resource.");
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
  ): Promise<void> {
    const solutionId = await this.getSolutionId(apiRoot, token, solutionName);
    if (!solutionId) {
      throw new Error(`Solution ${solutionName} not found.`);
    }

    const alreadyInSolution = await this.isComponentInSolution(
      apiRoot,
      token,
      componentId,
      solutionId,
    );

    if (alreadyInSolution) {
      return;
    }

    const url = `${apiRoot}/AddSolutionComponent`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        ComponentId: componentId,
        ComponentType: 61, // WebResource
        SolutionUniqueName: solutionName,
        AddRequiredComponents: false,
      }),
    });

    if (!response.ok) {
      throw await this.buildError(
        `Failed to add to solution ${solutionName}`,
        response,
      );
    }

    this.output.appendLine(`Added to solution ${solutionName}.`);
  }

  private async getSolutionId(
    apiRoot: string,
    token: string,
    solutionName: string,
  ): Promise<string | undefined> {
    const filter = encodeURIComponent(`uniquename eq '${solutionName.replace(/'/g, "''")}'`);
    const url = `${apiRoot}/solutions?$select=solutionid,uniquename&$filter=${filter}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
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
  ): Promise<boolean> {
    const normalizedComponentId = this.trimGuid(componentId);
    const normalizedSolutionId = this.trimGuid(solutionId);
    const filter = encodeURIComponent(
      `componenttype eq 61 and objectid eq ${normalizedComponentId} and _solutionid_value eq ${normalizedSolutionId}`,
    );
    const url = `${apiRoot}/solutioncomponents?$select=solutioncomponentid&$filter=${filter}&$top=1`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
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

  private async publishWebResource(
    apiRoot: string,
    token: string,
    webResourceId: string,
  ): Promise<void> {
    const url = `${apiRoot}/PublishXml`;
    const parameterXml = `<importexportxml><webresources><webresource>${webResourceId}</webresource></webresources></importexportxml>`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ ParameterXml: parameterXml }),
    });

    if (!response.ok) {
      throw await this.buildError("Failed to publish web resource", response);
    }

    this.output.appendLine("Web resource has been published.");
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
  ): Promise<string> {
    const tenantId = credentials.tenantId || "organizations";
    const resource = (env.resource || env.url).replace(/\/$/, "");
    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
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

  private async buildError(context: string, response: Response): Promise<Error> {
    const text = await response.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string; description?: string };
        Message?: string;
      };
      detail =
        parsed.error?.message ||
        parsed.error?.description ||
        parsed.Message ||
        text;
    } catch {
      // Ignore parse errors.
    }

    return new Error(`${context}: ${detail} (${response.status})`);
  }
}
