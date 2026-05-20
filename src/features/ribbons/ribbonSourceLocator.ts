import * as fs from "node:fs/promises";
import * as path from "node:path";
import { RibbonSource, RibbonSourceFile } from "./models";

export class RibbonSourceLocator {
  async locate(workspaceRoot: string | undefined): Promise<RibbonSource[]> {
    if (!workspaceRoot) {
      return [];
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

    return sources;
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
      const realPath = await realFilePath(candidate);
      if (realPath && !seen.has(realPath.toLowerCase())) {
        seen.add(realPath.toLowerCase());
        files.push(candidate);
      }
    }

    return files.sort((a, b) => a.localeCompare(b));
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
