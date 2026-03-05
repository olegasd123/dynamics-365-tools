import { DEFAULT_SOLUTION_NAME } from "../../shared/solutions";
import { EnvironmentConnection } from "./environmentConnectionService";

export class DataverseClient {
  constructor(private readonly connection: EnvironmentConnection) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  async delete(path: string): Promise<void> {
    await this.request<void>("DELETE", path);
  }

  get apiRoot(): string {
    return this.connection.apiRoot;
  }

  get environmentName(): string {
    return this.connection.env.name;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.normalizePath(path);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.withUserAgent({
          Authorization: `Bearer ${this.connection.token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(method === "POST" ? { Prefer: "return=representation" } : {}),
        }),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw this.buildFetchError(method, path, url, error);
    }

    if (!response.ok) {
      throw await this.buildError(method, path, url, response);
    }

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    if (!text.trim()) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  private normalizePath(path: string): string {
    if (path.startsWith("http")) {
      return path;
    }
    const trimmed = path.startsWith("/") ? path.slice(1) : path;
    return `${this.connection.apiRoot}/${trimmed}`;
  }

  async getCreatedId(response: Response): Promise<string | undefined> {
    const text = await response.clone().text();
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text) as { id?: string; pluginassemblyid?: string };
        if (parsed.id) {
          return parsed.id;
        }
        if (parsed.pluginassemblyid) {
          return parsed.pluginassemblyid;
        }
      } catch {
        // Ignore parse errors for headers.
      }
    }

    return (
      this.extractGuid(response.headers.get("OData-EntityId")) ||
      this.extractGuid(response.headers.get("odata-entityid"))
    );
  }

  private withUserAgent<T extends Record<string, string>>(
    headers: T,
  ): T & { "User-Agent"?: string } {
    const userAgent = this.connection.userAgent;
    if (!userAgent) {
      return headers;
    }
    return { ...headers, "User-Agent": userAgent };
  }

  private async buildError(
    method: string,
    path: string,
    url: string,
    response: Response,
  ): Promise<Error> {
    const context = `Dataverse ${method} ${path}`;
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
      requestMethod?: string;
      requestPath?: string;
      requestUrl?: string;
    };
    error.code = code;
    error.correlationId = correlationId;
    error.rawBody = text;
    error.status = response.status;
    error.requestMethod = method;
    error.requestPath = path;
    error.requestUrl = url;

    return error;
  }

  private buildFetchError(method: string, path: string, url: string, cause: unknown): Error {
    const details = this.describeErrorChain(cause);
    const message = `Dataverse ${method} ${path}: Network request failed for ${url}: ${details.summary}`;
    const error = new Error(message) as Error & {
      code?: string;
      requestMethod?: string;
      requestPath?: string;
      requestUrl?: string;
      causeName?: string;
      causeMessage?: string;
      causeCode?: string;
      causeChain?: string;
      causeStack?: string;
    };
    error.code = details.code;
    error.requestMethod = method;
    error.requestPath = path;
    error.requestUrl = url;
    error.causeName = details.name;
    error.causeMessage = details.summary;
    error.causeCode = details.code;
    error.causeChain = details.chain;
    error.causeStack = details.stack;
    return error;
  }

  private describeErrorChain(cause: unknown): {
    name?: string;
    summary: string;
    code?: string;
    chain: string;
    stack?: string;
  } {
    const parts: string[] = [];
    let current: unknown = cause;
    let fallbackName: string | undefined;
    let fallbackSummary: string | undefined;
    let fallbackCode: string | undefined;
    let fallbackStack: string | undefined;
    let depth = 0;

    while (current && depth < 6) {
      depth += 1;
      const currentName = this.readString(current, "name");
      const currentMessage = this.readString(current, "message");
      const currentCode = this.readString(current, "code");
      const currentStack = this.readString(current, "stack");

      if (!fallbackName && currentName) {
        fallbackName = currentName;
      }
      if (!fallbackSummary && currentMessage) {
        fallbackSummary = currentMessage;
      }
      if (!fallbackCode && currentCode) {
        fallbackCode = currentCode;
      }
      if (!fallbackStack && currentStack) {
        fallbackStack = currentStack;
      }

      const label = [currentName, currentMessage || currentCode].filter(Boolean).join(": ");
      if (label) {
        parts.push(label);
      }

      if (!this.hasProperty(current, "cause")) {
        break;
      }
      current = (current as Record<string, unknown>).cause;
    }

    const summary = fallbackSummary || String(cause);
    return {
      name: fallbackName,
      summary,
      code: fallbackCode,
      chain: parts.join(" -> "),
      stack: fallbackStack,
    };
  }

  private hasProperty(value: unknown, key: string): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && key in value;
  }

  private readString(value: unknown, key: string): string | undefined {
    if (!this.hasProperty(value, key)) {
      return undefined;
    }
    const property = value[key];
    return typeof property === "string" && property.trim() ? property : undefined;
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

  private extractGuid(entityIdHeader: string | null): string | undefined {
    if (!entityIdHeader) {
      return undefined;
    }
    const match = entityIdHeader.match(/[0-9a-fA-F-]{36}/);
    return match?.[0];
  }
}

export function isDefaultSolution(solutionName: string): boolean {
  return solutionName.trim().toLowerCase() === DEFAULT_SOLUTION_NAME.toLowerCase();
}
