import * as fs from "node:fs/promises";
import * as path from "node:path";
import JSZip from "jszip";
import type * as vscode from "vscode";
import type { DataverseClient } from "../dataverse/dataverseClient";
import { RibbonSource, RibbonSourceFile } from "./models";

export interface SolutionZipOpenOptions {
  storageRoot: string;
  sourceName: string;
  originalZipUri?: string;
}

export interface DataverseSolutionSummary {
  uniqueName: string;
  friendlyName?: string;
  version?: string;
}

interface DataverseSolutionsResponse {
  value?: Array<{
    uniquename?: string;
    friendlyname?: string;
    version?: string;
  }>;
}

interface ExportSolutionResponse {
  ExportSolutionFile?: string;
  exportsolutionfile?: string;
}

export class SolutionExportCancelledError extends Error {
  readonly cancelled = true;

  constructor() {
    super("Solution export cancelled.");
    this.name = "SolutionExportCancelledError";
  }
}

export class SolutionZipService {
  async openZipFile(zipFileUri: string, storageRoot: string): Promise<RibbonSource> {
    const buffer = await fs.readFile(zipFileUri);
    return this.openZipBuffer(buffer, {
      storageRoot,
      sourceName: path.basename(zipFileUri),
      originalZipUri: zipFileUri,
    });
  }

  async openZipBuffer(buffer: Buffer, options: SolutionZipOpenOptions): Promise<RibbonSource> {
    const zip = await JSZip.loadAsync(buffer);
    const extractedRoot = await this.createExtractionRoot(options.storageRoot, options.sourceName);
    const entries: string[] = [];

    for (const entry of Object.values(zip.files)) {
      if (entry.dir) {
        continue;
      }

      const safeName = normalizeLoadedZipEntryName(entry.name, entry.unsafeOriginalName);
      if (!safeName) {
        continue;
      }

      const outputPath = path.join(extractedRoot, ...safeName.split("/"));
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, await entry.async("nodebuffer"));
      entries.push(safeName);
    }

    return {
      id: `zip:${extractedRoot}`,
      kind: "zip",
      name: options.sourceName,
      rootUri: extractedRoot,
      files: await findRibbonSourceFiles(extractedRoot, entries),
      zip: {
        originalZipUri: options.originalZipUri,
        extractedRootUri: extractedRoot,
        entries: entries.sort((a, b) => a.localeCompare(b)),
      },
    };
  }

  async saveSourceToZip(source: RibbonSource, outputZipUri?: string): Promise<string> {
    if (source.kind !== "zip" || !source.zip) {
      throw new Error("Select an imported solution zip source first.");
    }

    const targetUri = outputZipUri ?? source.zip.originalZipUri;
    if (!targetUri) {
      throw new Error("Pick a target zip file.");
    }

    const zip = new JSZip();
    for (const entryName of source.zip.entries) {
      const filePath = path.join(source.zip.extractedRootUri, ...entryName.split("/"));
      if (!(await isFile(filePath))) {
        throw new Error(`Extracted zip entry is missing: ${entryName}`);
      }

      zip.file(entryName, await fs.readFile(filePath));
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await fs.writeFile(targetUri, buffer);
    return targetUri;
  }

  async saveBufferToZip(buffer: Buffer, outputZipUri: string): Promise<string> {
    await fs.mkdir(path.dirname(outputZipUri), { recursive: true });
    await fs.writeFile(outputZipUri, buffer);
    return outputZipUri;
  }

  async listUnmanagedSolutions(client: DataverseClient): Promise<DataverseSolutionSummary[]> {
    const response = await client.get<DataverseSolutionsResponse>(
      "/solutions?$select=uniquename,friendlyname,version&$filter=ismanaged eq false&$orderby=uniquename",
    );

    return (response.value ?? [])
      .map((solution) => ({
        uniqueName: solution.uniquename?.trim() ?? "",
        friendlyName: solution.friendlyname,
        version: solution.version,
      }))
      .filter((solution) => solution.uniqueName.length > 0);
  }

  async downloadSolutionZip(
    client: DataverseClient,
    uniqueName: string,
    token?: vscode.CancellationToken,
  ): Promise<Buffer> {
    throwIfExportCancelled(token);

    const controller = new AbortController();
    const cancellationListener = token?.onCancellationRequested(() => controller.abort());

    let response: ExportSolutionResponse;
    try {
      response = await client.post<ExportSolutionResponse>(
        "ExportSolution",
        {
          SolutionName: uniqueName,
          Managed: false,
        },
        { signal: controller.signal },
      );
    } catch (error) {
      if (isAbortError(error) || token?.isCancellationRequested) {
        throw new SolutionExportCancelledError();
      }
      throw error;
    } finally {
      cancellationListener?.dispose();
    }

    throwIfExportCancelled(token);

    const base64 = response.ExportSolutionFile ?? response.exportsolutionfile;
    if (!base64) {
      throw new Error("Dataverse did not return a solution zip.");
    }

    return Buffer.from(base64, "base64");
  }

  private async createExtractionRoot(storageRoot: string, sourceName: string): Promise<string> {
    const parent = path.join(storageRoot, "ribbon-zips");
    await fs.mkdir(parent, { recursive: true });
    return fs.mkdtemp(path.join(parent, `${slug(sourceName)}-`));
  }
}

export function isSolutionExportCancelledError(error: unknown): boolean {
  return error instanceof SolutionExportCancelledError || Boolean((error as any)?.cancelled);
}

function throwIfExportCancelled(token?: vscode.CancellationToken): void {
  if (token?.isCancellationRequested) {
    throw new SolutionExportCancelledError();
  }
}

function isAbortError(error: unknown): boolean {
  return (error as any)?.name === "AbortError";
}

async function findRibbonSourceFiles(root: string, entries: string[]): Promise<RibbonSourceFile[]> {
  const files: RibbonSourceFile[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const lower = entry.toLowerCase();
    const fileUri = path.join(root, ...entry.split("/"));

    if (isFlatCustomizationsEntry(lower)) {
      pushFile(files, seen, { fileUri, kind: "Flat" });
      continue;
    }

    const entityName = entityRibbonName(entry);
    if (entityName) {
      pushFile(files, seen, {
        fileUri,
        kind: "Entity",
        entityLogicalName: entityName,
      });
      continue;
    }

    if (lower === "appribbon/ribbondiffxml.xml" || lower === "other/customizations.xml") {
      pushFile(files, seen, { fileUri, kind: "Application" });
    }
  }

  return files.sort((a, b) => a.fileUri.localeCompare(b.fileUri));
}

function pushFile(files: RibbonSourceFile[], seen: Set<string>, file: RibbonSourceFile): void {
  const key = file.fileUri.toLowerCase();
  if (!seen.has(key)) {
    seen.add(key);
    files.push(file);
  }
}

function isFlatCustomizationsEntry(entryName: string): boolean {
  return entryName === "customizations.xml" || entryName.endsWith("/customizations.xml");
}

function entityRibbonName(entryName: string): string | undefined {
  const match = /^Entities\/([^/]+)\/RibbonDiffXml\.xml$/i.exec(entryName);
  return match?.[1];
}

function normalizeLoadedZipEntryName(
  entryName: string,
  unsafeOriginalName: string | undefined,
): string | undefined {
  const safeName = normalizeZipEntryName(entryName);
  if (!safeName) {
    return undefined;
  }

  if (!unsafeOriginalName) {
    return safeName;
  }

  return normalizeZipEntryName(unsafeOriginalName) === safeName ? safeName : undefined;
}

function normalizeZipEntryName(entryName: string): string | undefined {
  const normalized = entryName.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) {
    return undefined;
  }

  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return undefined;
  }

  return parts.join("/");
}

export async function cleanRibbonZipsFolder(folderPath: string, keepCount: number): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(folderPath, { withFileTypes: true });
  } catch {
    return; // folder doesn't exist yet — nothing to clean
  }

  const dirs = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const fullPath = path.join(folderPath, e.name);
        const stat = await fs.stat(fullPath);
        return { fullPath, mtime: stat.mtimeMs };
      }),
  );

  dirs.sort((a, b) => b.mtime - a.mtime);
  const toDelete = dirs.slice(keepCount);

  await Promise.all(toDelete.map((d) => fs.rm(d.fullPath, { recursive: true, force: true })));
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function slug(value: string): string {
  const text = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || "solution";
}
