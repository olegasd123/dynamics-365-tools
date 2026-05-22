import { randomUUID } from "crypto";
import { XMLParser } from "fast-xml-parser";
import type * as vscode from "vscode";

export interface SolutionImportClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  delete?(path: string): Promise<void>;
}

export interface SolutionImportOptions {
  importJobId?: string;
  async?: boolean;
  overwriteUnmanagedCustomizations?: boolean;
  publishWorkflows?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  token?: vscode.CancellationToken;
  onStatus?: (message: string) => void;
}

export interface SolutionImportResult {
  importJobId: string;
  asyncOperationId?: string;
  durationMs: number;
  log?: string;
  warnings: string[];
}

interface ImportSolutionAsyncResponse {
  AsyncOperationId?: string;
  asyncoperationid?: string;
  ImportJobKey?: string;
  importjobkey?: string;
}

interface AsyncOperationRecord {
  asyncoperationid?: string;
  statecode?: number;
  statuscode?: number;
  message?: string;
  friendlymessage?: string;
  errortext?: string;
}

interface ImportJobRecord {
  importjobid?: string;
  data?: string;
  progress?: number;
  solutionname?: string;
}

export class SolutionImportError extends Error {
  constructor(
    message: string,
    readonly importJobId: string,
    readonly errors: string[] = [],
    readonly log?: string,
  ) {
    super(errors.length ? `${message}: ${errors.join("; ")}` : message);
    this.name = "SolutionImportError";
  }
}

export class SolutionImportService {
  constructor(private readonly client: SolutionImportClient) {}

  async importSolution(
    zipBytes: Uint8Array,
    options: SolutionImportOptions = {},
  ): Promise<SolutionImportResult> {
    const started = Date.now();
    const importJobId = normalizeGuid(options.importJobId ?? randomUUID());
    const body = {
      OverwriteUnmanagedCustomizations: options.overwriteUnmanagedCustomizations ?? false,
      PublishWorkflows: options.publishWorkflows ?? true,
      CustomizationFile: Buffer.from(zipBytes).toString("base64"),
      ImportJobId: importJobId,
    };

    this.throwIfCancelled(options.token);

    if (options.async === false) {
      options.onStatus?.("Importing solution");
      await this.client.post("ImportSolution", body);
      const job = await this.getImportJob(importJobId);
      const errors = parseImportErrors(job?.data);
      if (errors.length) {
        throw new SolutionImportError("Solution import failed", importJobId, errors, job?.data);
      }
      return {
        importJobId,
        durationMs: Date.now() - started,
        log: job?.data,
        warnings: parseImportWarnings(job?.data),
      };
    }

    options.onStatus?.("Starting solution import");
    const response = await this.client.post<ImportSolutionAsyncResponse>(
      "ImportSolutionAsync",
      body,
    );
    const asyncOperationId = normalizeGuid(
      response.AsyncOperationId ?? response.asyncoperationid ?? "",
    );

    return this.pollImport(importJobId, asyncOperationId || undefined, started, options);
  }

  async publishCustomControls(customControlIds: string[]): Promise<void> {
    const ids = customControlIds.map(normalizeGuid).filter(Boolean);
    if (!ids.length) {
      return;
    }

    await this.client.post("PublishXml", {
      ParameterXml: buildPublishCustomControlsXml(ids),
    });
  }

  async publishRibbons(entities: string[], includeApplicationRibbon = false): Promise<void> {
    const normalizedEntities = entities.map((entity) => entity.trim()).filter(Boolean);
    if (!normalizedEntities.length && !includeApplicationRibbon) {
      return;
    }

    await this.client.post("PublishXml", {
      ParameterXml: buildPublishRibbonsXml(normalizedEntities, includeApplicationRibbon),
    });
  }

  private async pollImport(
    importJobId: string,
    asyncOperationId: string | undefined,
    started: number,
    options: SolutionImportOptions,
  ): Promise<SolutionImportResult> {
    const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    const pollIntervalMs = options.pollIntervalMs ?? 5000;
    const deadline = started + timeoutMs;

    while (Date.now() <= deadline) {
      this.throwIfCancelled(options.token);

      const operation = asyncOperationId
        ? await this.getAsyncOperation(asyncOperationId)
        : undefined;
      if (operation) {
        const message = operation.friendlymessage ?? operation.message;
        if (message) {
          options.onStatus?.(message);
        }

        if (isAsyncOperationFailure(operation)) {
          const job = await this.getImportJob(importJobId);
          const errors = [
            operation.errortext,
            operation.message,
            ...parseImportErrors(job?.data),
          ].filter((item): item is string => Boolean(item?.trim()));
          throw new SolutionImportError(
            "Solution import failed",
            importJobId,
            unique(errors),
            job?.data,
          );
        }

        if (isAsyncOperationSuccess(operation)) {
          const job = await this.getImportJob(importJobId);
          return {
            importJobId,
            asyncOperationId,
            durationMs: Date.now() - started,
            log: job?.data,
            warnings: parseImportWarnings(job?.data),
          };
        }
      }

      await delay(pollIntervalMs);
    }

    throw new SolutionImportError(`Solution import timed out after ${timeoutMs}ms`, importJobId);
  }

  private getAsyncOperation(asyncOperationId: string): Promise<AsyncOperationRecord> {
    return this.client.get<AsyncOperationRecord>(
      `/asyncoperations(${asyncOperationId})?$select=asyncoperationid,statecode,statuscode,message,friendlymessage,errortext`,
    );
  }

  private async getImportJob(importJobId: string): Promise<ImportJobRecord | undefined> {
    try {
      return await this.client.get<ImportJobRecord>(
        `/importjobs(${importJobId})?$select=importjobid,data,progress,solutionname`,
      );
    } catch {
      return undefined;
    }
  }

  private throwIfCancelled(token?: vscode.CancellationToken): void {
    if (token?.isCancellationRequested) {
      throw new Error("Solution import cancelled.");
    }
  }
}

export function buildPublishCustomControlsXml(customControlIds: string[]): string {
  const controls = customControlIds
    .map(normalizeGuid)
    .filter(Boolean)
    .map((id) => `<customcontrol>${escapeXml(id)}</customcontrol>`)
    .join("");
  return `<importexportxml><customcontrols>${controls}</customcontrols></importexportxml>`;
}

export function buildPublishRibbonsXml(
  entities: string[],
  includeApplicationRibbon = false,
): string {
  const entityXml = entities
    .map((entity) => entity.trim())
    .filter(Boolean)
    .map((entity) => `<entity>${escapeXml(entity)}</entity>`)
    .join("");
  const entitiesXml = entityXml ? `<entities>${entityXml}</entities>` : "";
  const ribbonXml = includeApplicationRibbon ? "<ribbon />" : "";
  return `<importexportxml>${entitiesXml}${ribbonXml}</importexportxml>`;
}

export function parseImportErrors(log?: string): string[] {
  return parseImportMessages(log, true);
}

export function parseImportWarnings(log?: string): string[] {
  return parseImportMessages(log, false);
}

function parseImportMessages(log: string | undefined, errors: boolean): string[] {
  if (!log?.trim()) {
    return [];
  }

  try {
    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(
      log,
    ) as unknown;
    return unique(collectImportMessages(parsed, errors));
  } catch {
    return errors && /error|failed|failure/i.test(log) ? [trimMessage(log)] : [];
  }
}

function collectImportMessages(value: unknown, errors: boolean): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectImportMessages(item, errors));
  }

  if (!isRecord(value)) {
    return [];
  }

  const result = readString(value["@_result"]);
  const status = readString(value["@_status"]);
  const hasError =
    /fail|error/i.test(result ?? "") ||
    /fail|error/i.test(status ?? "") ||
    Boolean(readString(value["@_errortext"]) ?? readString(value.errortext));
  const hasWarning = /warn/i.test(result ?? "") || /warn/i.test(status ?? "");
  const currentMatches = errors ? hasError : hasWarning;
  const messages: string[] = [];

  if (currentMatches) {
    const message =
      readString(value["@_errortext"]) ??
      readString(value.errortext) ??
      readString(value["@_description"]) ??
      readString(value.description) ??
      readString(value["@_name"]) ??
      readString(value.name);
    if (message) {
      messages.push(trimMessage(message));
    }
  }

  for (const child of Object.values(value)) {
    messages.push(...collectImportMessages(child, errors));
  }

  return messages;
}

function isAsyncOperationSuccess(operation: AsyncOperationRecord): boolean {
  return (
    operation.statecode === 3 && (operation.statuscode === undefined || operation.statuscode === 30)
  );
}

function isAsyncOperationFailure(operation: AsyncOperationRecord): boolean {
  return (
    operation.statecode === 3 && operation.statuscode !== undefined && operation.statuscode !== 30
  );
}

function normalizeGuid(value: string): string {
  return value.replace(/[{}]/g, "").trim().toLowerCase();
}

function trimMessage(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(trimMessage).filter(Boolean))];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
