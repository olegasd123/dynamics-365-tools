import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { RibbonSource, RibbonSourceFile } from "./models";

const MAX_FLAT_CUSTOMIZATIONS_DEPTH = 4;
const IGNORED_FLAT_CUSTOMIZATIONS_DIRS = new Set([
  "bin",
  "build",
  "dist",
  "node_modules",
  "obj",
  "out",
]);

export class RibbonSourceLocator {
  private readonly importedSources = new Map<string, RibbonSource>();

  addImportedSource(source: RibbonSource): void {
    this.importedSources.set(source.id, source);
  }

  removeImportedSource(sourceId: string): boolean {
    return this.importedSources.delete(sourceId);
  }

  async locate(workspaceRoot: string | undefined): Promise<RibbonSource[]> {
    const imported = [...this.importedSources.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    if (!workspaceRoot) {
      return imported;
    }

    const root = path.resolve(workspaceRoot);
    const sources: RibbonSource[] = [];
    const unpackedFiles = await this.findUnpackedFiles(root);

    if (unpackedFiles.length) {
      sources.push({
        id: `unpacked:${root}`,
        kind: "unpacked",
        name: "Workspace solution",
        rootUri: root,
        files: unpackedFiles,
      });
    }

    for (const fileUri of await this.findFlatCustomizationFiles(root)) {
      sources.push({
        id: `flat:${fileUri}`,
        kind: "flat",
        name: path.relative(root, fileUri) || path.basename(fileUri),
        rootUri: root,
        files: [{ fileUri, kind: "Flat" }],
      });
    }

    return [...sources, ...imported];
  }

  private async findUnpackedFiles(root: string): Promise<RibbonSourceFile[]> {
    const files: RibbonSourceFile[] = [];

    for (const appRibbonPath of [
      path.join(root, "AppRibbon", "RibbonDiffXml.xml"),
      path.join(root, "Other", "Customizations.xml"),
    ]) {
      if (await exists(appRibbonPath)) {
        files.push({ fileUri: appRibbonPath, kind: "Application" });
      }
    }

    const entitiesRoot = path.join(root, "Entities");
    if (!(await isDirectory(entitiesRoot))) {
      return files;
    }

    for (const entityName of await readDirectoryNames(entitiesRoot)) {
      const ribbonPath = path.join(entitiesRoot, entityName, "RibbonDiffXml.xml");
      if (await exists(ribbonPath)) {
        files.push({
          fileUri: ribbonPath,
          kind: "Entity",
          entityLogicalName: entityName,
        });
      }
    }

    return files.sort((a, b) => a.fileUri.localeCompare(b.fileUri));
  }

  private async findFlatCustomizationFiles(root: string): Promise<string[]> {
    const candidates = [
      path.join(root, "customizations.xml"),
      path.join(root, "Customizations.xml"),
      path.join(root, "solution", "customizations.xml"),
      path.join(root, "solution", "Customizations.xml"),
    ];
    const files: string[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      await addFlatCustomizationFile(candidate, files, seen);
    }

    for (const candidate of await findNestedFlatCustomizationFiles(root)) {
      await addFlatCustomizationFile(candidate, files, seen);
    }

    return files.sort((a, b) => a.localeCompare(b));
  }
}

async function addFlatCustomizationFile(
  candidate: string,
  files: string[],
  seen: Set<string>,
): Promise<void> {
  const realPath = await realFilePath(candidate);
  if (realPath) {
    const key = realPath.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      files.push(candidate);
    }
  }
}

async function exists(fsPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(fsPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function isDirectory(fsPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(fsPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function realFilePath(fsPath: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(fsPath);
    if (!stat.isFile()) {
      return undefined;
    }

    return fs.realpath(fsPath);
  } catch {
    return undefined;
  }
}

async function readDirectoryNames(fsPath: string): Promise<string[]> {
  const entries = await fs.readdir(fsPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function findNestedFlatCustomizationFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await collectNestedFlatCustomizationFiles(root, 0, files);
  return files;
}

async function collectNestedFlatCustomizationFiles(
  directory: string,
  depth: number,
  files: string[],
): Promise<void> {
  let entries: Dirent[];

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === "customizations.xml") {
      files.push(path.join(directory, entry.name));
    }
  }

  if (depth >= MAX_FLAT_CUSTOMIZATIONS_DEPTH) {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && shouldSearchFlatCustomizationDirectory(entry.name)) {
      await collectNestedFlatCustomizationFiles(path.join(directory, entry.name), depth + 1, files);
    }
  }
}

function shouldSearchFlatCustomizationDirectory(name: string): boolean {
  return !name.startsWith(".") && !IGNORED_FLAT_CUSTOMIZATIONS_DIRS.has(name);
}
