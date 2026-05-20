import * as fs from "node:fs/promises";
import { RibbonDocument, RibbonPatch, RibbonSource, RibbonSourceFile } from "./models";
import { applyRibbonPatches } from "./ribbonPatchWriter";
import { readRibbonDocuments } from "./ribbonXmlReader";

export type RibbonPatchMap = Map<string, RibbonPatch[]> | Record<string, RibbonPatch[]>;

export interface RibbonSaveResult {
  changedFileUris: string[];
}

export class RibbonRepository {
  async loadSource(source: RibbonSource): Promise<RibbonDocument[]> {
    const documents: RibbonDocument[] = [];

    for (const file of source.files) {
      documents.push(...(await this.loadFile(source, file)));
    }

    return documents;
  }

  async loadFile(source: RibbonSource, file: RibbonSourceFile): Promise<RibbonDocument[]> {
    const sourceText = await fs.readFile(file.fileUri, "utf8");
    const options =
      file.kind === "Flat"
        ? { sourceId: source.id, fileUri: file.fileUri }
        : {
            sourceId: source.id,
            fileUri: file.fileUri,
            kind: file.kind,
            entityLogicalName: file.entityLogicalName,
          };

    return readRibbonDocuments(sourceText, options);
  }

  async savePatches(patchesByFileUri: RibbonPatchMap): Promise<RibbonSaveResult> {
    const changedFileUris: string[] = [];

    for (const [fileUri, patches] of patchEntries(patchesByFileUri)) {
      if (!patches.length) {
        continue;
      }

      const sourceText = await fs.readFile(fileUri, "utf8");
      const updatedText = applyRibbonPatches(sourceText, patches);
      if (updatedText === sourceText) {
        continue;
      }

      await fs.writeFile(fileUri, updatedText, "utf8");
      changedFileUris.push(fileUri);
    }

    return { changedFileUris };
  }
}

function patchEntries(patchesByFileUri: RibbonPatchMap): Array<[string, RibbonPatch[]]> {
  if (patchesByFileUri instanceof Map) {
    return [...patchesByFileUri.entries()];
  }

  return Object.entries(patchesByFileUri);
}
