import * as fs from "node:fs/promises";
import { RibbonDocument, RibbonPatch, RibbonSource } from "./models";
import { applyRibbonPatchSequence } from "./ribbonPatchWriter";
import { RibbonRepository, RibbonSaveResult } from "./ribbonRepository";

export class RibbonEditorState {
  private readonly sourcesById = new Map<string, RibbonSource>();
  private readonly documentsBySourceId = new Map<string, RibbonDocument[]>();
  private readonly patchesByFileUri = new Map<string, RibbonPatch[]>();

  constructor(private readonly repository: RibbonRepository) {}

  async loadSource(source: RibbonSource): Promise<RibbonDocument[]> {
    this.sourcesById.set(source.id, source);
    const cached = this.documentsBySourceId.get(source.id);
    if (cached) {
      return cached;
    }

    const documents = await this.reloadSource(source);
    return documents;
  }

  getDocuments(sourceId: string): RibbonDocument[] | undefined {
    return this.documentsBySourceId.get(sourceId);
  }

  isSourceDirty(sourceId: string): boolean {
    const source = this.sourcesById.get(sourceId);
    return !!source?.files.some((file) => this.hasFilePatches(file.fileUri));
  }

  isFileDirty(fileUri: string): boolean {
    return this.hasFilePatches(fileUri);
  }

  queuePatches(document: RibbonDocument, patches: RibbonPatch[]): void {
    if (!patches.length) {
      return;
    }

    const current = this.patchesByFileUri.get(document.fileUri) ?? [];
    this.patchesByFileUri.set(document.fileUri, [...current, ...patches]);
    this.documentsBySourceId.delete(document.sourceId);
  }

  clear(): void {
    this.documentsBySourceId.clear();
    this.sourcesById.clear();
  }

  clearCachedDocuments(): void {
    this.documentsBySourceId.clear();
  }

  async saveSource(sourceId: string): Promise<RibbonSaveResult> {
    const source = this.sourcesById.get(sourceId);
    if (!source) {
      return { changedFileUris: [] };
    }

    const patches = new Map<string, RibbonPatch[]>();
    for (const file of source.files) {
      const filePatches = this.patchesByFileUri.get(file.fileUri) ?? [];
      if (filePatches.length) {
        patches.set(file.fileUri, filePatches);
      }
    }

    const result = await this.repository.savePatchSequence(patches);

    for (const file of source.files) {
      this.patchesByFileUri.delete(file.fileUri);
    }
    this.documentsBySourceId.delete(source.id);
    await this.reloadSource(source);
    return result;
  }

  async saveAllSources(): Promise<RibbonSaveResult> {
    const changedFileUris: string[] = [];

    for (const sourceId of [...this.sourcesById.keys()]) {
      const result = await this.saveSource(sourceId);
      changedFileUris.push(...result.changedFileUris);
    }

    return { changedFileUris };
  }

  private async reloadSource(source: RibbonSource): Promise<RibbonDocument[]> {
    const overlay = await this.buildSourceTextOverlay(source);
    const documents = (await this.repository.loadSource(source, overlay)).sort(compareDocuments);
    this.documentsBySourceId.set(source.id, documents);
    return documents;
  }

  private async buildSourceTextOverlay(source: RibbonSource): Promise<Map<string, string>> {
    const overlay = new Map<string, string>();

    for (const file of source.files) {
      const patches = this.patchesByFileUri.get(file.fileUri) ?? [];
      if (!patches.length) {
        continue;
      }

      const sourceText = await fs.readFile(file.fileUri, "utf8");
      overlay.set(file.fileUri, applyRibbonPatchSequence(sourceText, patches));
    }

    return overlay;
  }

  private hasFilePatches(fileUri: string): boolean {
    return (this.patchesByFileUri.get(fileUri) ?? []).length > 0;
  }
}

function compareDocuments(a: RibbonDocument, b: RibbonDocument): number {
  if (a.kind !== b.kind) {
    return a.kind === "Application" ? -1 : 1;
  }

  return documentLabel(a).localeCompare(documentLabel(b), undefined, { sensitivity: "base" });
}

function documentLabel(document: RibbonDocument): string {
  return document.kind === "Application"
    ? "Application Ribbon"
    : (document.entityLogicalName ?? "Entity Ribbon");
}
