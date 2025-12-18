import { DEFAULT_SOLUTION_NAME } from "../../types";
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
    const response = await fetch(url, {
      method,
      headers: this.withUserAgent({
        Authorization: `Bearer ${this.connection.token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(method === "POST" ? { Prefer: "return=representation" } : {}),
      }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw await this.buildError(`Dataverse ${method} ${path}`, response);
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
