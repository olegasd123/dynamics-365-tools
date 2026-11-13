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

export interface ImportedRibbonSolution {
  source: RibbonSource;
  importedAt: number;
}

interface ImportedSolutionMetadata {
  name: string;
  importedAt: number;
  originalZipUri?: string;
  entries: string[];
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

    const source: RibbonSource = {
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

    const metadata: ImportedSolutionMetadata = {
      name: options.sourceName,
      importedAt: Date.now(),
      originalZipUri: options.originalZipUri,
      entries,
    };
    await fs.writeFile(`${extractedRoot}.json`, JSON.stringify(metadata), "utf8");
    return source;
  }

  async listImportedSolutions(storageRoot: string): Promise<ImportedRibbonSolution[]> {
    const parent = path.join(storageRoot, "ribbon-zips");
    let directories: import("node:fs").Dirent[];
    try {
      directories = await fs.readdir(parent, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const solutions = await Promise.all(
      directories
        .filter((entry) => entry.isDirectory())
        .map(async (directory): Promise<ImportedRibbonSolution | undefined> => {
          const root = path.join(parent, directory.name);
          try {
            const [stat, metadata, entries] = await Promise.all([
              fs.stat(root),
              readImportedSolutionMetadata(root),
              listExtractedEntries(root),
            ]);
            const files = await findRibbonSourceFiles(root, entries);
            if (!files.length) {
              return undefined;
            }

            return {
              importedAt: metadata?.importedAt ?? stat.mtimeMs,
              source: {
                id: `zip:${root}`,
                kind: "zip",
                name:
                  metadata?.name ??
                  directory.name.replace(/-[^-]{6}$/, "").replace(/-zip$/, ".zip"),
                rootUri: root,
                files,
                zip: {
                  originalZipUri: metadata?.originalZipUri,
                  extractedRootUri: root,
                  entries: metadata?.entries ?? entries,
                },
              },
            };
          } catch (error) {
            // Cleanup may remove a retained folder while the list is loading.
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              return undefined;
            }
            throw error;
          }
        }),
    );

    return solutions
      .filter((solution): solution is ImportedRibbonSolution => solution !== undefined)
      .sort(
        (a, b) => b.importedAt - a.importedAt || a.source.rootUri.localeCompare(b.source.rootUri),
      );
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

async function readImportedSolutionMetadata(
  root: string,
): Promise<ImportedSolutionMetadata | undefined> {
  try {
    const metadata = JSON.parse(
      await fs.readFile(`${root}.json`, "utf8"),
    ) as Partial<ImportedSolutionMetadata> | null;
    if (
      metadata &&
      typeof metadata.name === "string" &&
      metadata.name.trim() &&
      typeof metadata.importedAt === "number" &&
      Number.isFinite(metadata.importedAt) &&
      (metadata.originalZipUri === undefined || typeof metadata.originalZipUri === "string") &&
      Array.isArray(metadata.entries) &&
      metadata.entries.every(
        (entry) => typeof entry === "string" && normalizeZipEntryName(entry) === entry,
      )
    ) {
      return metadata as ImportedSolutionMetadata;
    }
    return undefined;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function listExtractedEntries(root: string, relativePath = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, relativePath), { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return listExtractedEntries(root, entryPath);
      }
      return entry.isFile() ? [entryPath] : [];
    }),
  );
  return files.flat().sort((a, b) => a.localeCompare(b));
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

  await Promise.all(
    toDelete.map(async (directory) => {
      await fs.rm(directory.fullPath, { recursive: true, force: true });
      await fs.rm(`${directory.fullPath}.json`, { force: true });
    }),
  );
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
