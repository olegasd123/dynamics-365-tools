import * as fs from "node:fs/promises";
import { RibbonDocument, RibbonPatch, RibbonSource, RibbonSourceFile } from "./models";
import { applyRibbonPatchSequence } from "./ribbonPatchWriter";
import { readRibbonDocuments } from "./ribbonXmlReader";

export type RibbonPatchMap = Map<string, RibbonPatch[]> | Record<string, RibbonPatch[]>;

export interface RibbonSaveResult {
  changedFileUris: string[];
}

export class RibbonRepository {
  async loadSource(
    source: RibbonSource,
    sourceTextByFileUri: Map<string, string> = new Map(),
  ): Promise<RibbonDocument[]> {
    const documents: RibbonDocument[] = [];

    for (const file of source.files) {
      documents.push(...(await this.loadFile(source, file, sourceTextByFileUri.get(file.fileUri))));
    }

    return documents;
  }

  async loadFile(
    source: RibbonSource,
    file: RibbonSourceFile,
    sourceText?: string,
  ): Promise<RibbonDocument[]> {
    const text = sourceText ?? (await fs.readFile(file.fileUri, "utf8"));
    const options =
      file.kind === "Flat"
        ? { sourceId: source.id, fileUri: file.fileUri }
        : {
            sourceId: source.id,
            fileUri: file.fileUri,
            kind: file.kind,
            entityLogicalName: file.entityLogicalName,
          };

    return readRibbonDocuments(text, options);
  }

  async savePatchSequence(patchesByFileUri: RibbonPatchMap): Promise<RibbonSaveResult> {
    const changedFileUris: string[] = [];

    for (const [fileUri, patches] of patchEntries(patchesByFileUri)) {
      if (!patches.length) {
        continue;
      }

      const sourceText = await fs.readFile(fileUri, "utf8");
      const updatedText = applyRibbonPatchSequence(sourceText, patches);
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
