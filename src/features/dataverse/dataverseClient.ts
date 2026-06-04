import { DEFAULT_SOLUTION_NAME } from "../../shared/solutions";
import type { EnvironmentConnection } from "./environmentConnectionService";

export interface DataverseRequestOptions {
  signal?: AbortSignal;
}

export interface DataverseClientOptions {
  fetch?: typeof fetch;
  maxAttempts?: number;
  retryDelayBaseMs?: number;
  retryDelayMaxMs?: number;
  retryJitter?: boolean;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_BASE_MS = 500;
const DEFAULT_RETRY_DELAY_MAX_MS = 8000;

export class DataverseClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly retryDelayBaseMs: number;
  private readonly retryDelayMaxMs: number;
  private readonly retryJitter: boolean;
  private readonly sleepImpl: (delayMs: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    private readonly connection: EnvironmentConnection,
    options: DataverseClientOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
    this.retryDelayBaseMs = Math.max(0, options.retryDelayBaseMs ?? DEFAULT_RETRY_DELAY_BASE_MS);
    this.retryDelayMaxMs = Math.max(
      this.retryDelayBaseMs,
      options.retryDelayMaxMs ?? DEFAULT_RETRY_DELAY_MAX_MS,
    );
    this.retryJitter = options.retryJitter ?? true;
    this.sleepImpl = options.sleep ?? this.sleep;
  }

  async get<T>(path: string, options?: DataverseRequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, options);
  }

  async post<T>(path: string, body?: unknown, options?: DataverseRequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, options);
  }

  async patch<T>(path: string, body: unknown, options?: DataverseRequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, body, options);
  }

  async delete(path: string, options?: DataverseRequestOptions): Promise<void> {
    await this.request<void>("DELETE", path, undefined, options);
  }

  get apiRoot(): string {
    return this.connection.apiRoot;
  }

  get environmentName(): string {
    return this.connection.env.name;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: DataverseRequestOptions,
  ): Promise<T> {
    const url = this.normalizePath(path);
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: this.withUserAgent({
            Authorization: `Bearer ${this.connection.token}`,
            Accept: "application/json",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(method === "POST" ? { Prefer: "return=representation" } : {}),
          }),
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: options?.signal,
        });
      } catch (error) {
        throw this.buildFetchError(method, path, url, error);
      }

      if (!response.ok) {
        if (!this.shouldRetry(response, attempt, options?.signal)) {
          throw await this.buildError(method, path, url, response);
        }

        await this.sleepImpl(this.getRetryDelayMs(response, attempt), options?.signal);
        continue;
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

    throw new Error(`Dataverse ${method} ${path}: Request retry attempts were exhausted.`);
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

  private shouldRetry(response: Response, attempt: number, signal?: AbortSignal): boolean {
    return (
      !signal?.aborted && attempt < this.maxAttempts && RETRYABLE_STATUSES.has(response.status)
    );
  }

  private getRetryDelayMs(response: Response, attempt: number): number {
    const serverDelayMs = this.parseRetryAfterMs(response);
    if (serverDelayMs !== undefined) {
      return serverDelayMs;
    }

    const delayMs = Math.min(
      this.retryDelayBaseMs * 2 ** Math.max(0, attempt - 1),
      this.retryDelayMaxMs,
    );
    if (!this.retryJitter || delayMs === 0) {
      return delayMs;
    }

    const jitterFactor = 0.8 + Math.random() * 0.4;
    return Math.round(delayMs * jitterFactor);
  }

  private parseRetryAfterMs(response: Response): number | undefined {
    const retryAfterMs = response.headers.get("x-ms-retry-after-ms");
    if (retryAfterMs) {
      const parsed = Number(retryAfterMs);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }

    const retryAfter = response.headers.get("Retry-After");
    if (!retryAfter) {
      return undefined;
    }

    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const dateMs = Date.parse(retryAfter);
    if (Number.isNaN(dateMs)) {
      return undefined;
    }

    return Math.max(0, dateMs - Date.now());
  }

  private sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (delayMs <= 0) {
      return Promise.resolve();
    }
    if (signal?.aborted) {
      return Promise.reject(new Error("Dataverse request retry was cancelled."));
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout);
        reject(new Error("Dataverse request retry was cancelled."));
      };
      const timeout = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
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
