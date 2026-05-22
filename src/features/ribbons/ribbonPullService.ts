import { RibbonDocument, RibbonPatch } from "./models";

export interface RibbonPullPlan {
  patchesByFileUri: Map<string, RibbonPatch[]>;
  matchedDocuments: RibbonDocument[];
  unchangedDocuments: RibbonDocument[];
  missingDocuments: RibbonDocument[];
}

export function createRibbonPullPlan(
  targetDocuments: RibbonDocument[],
  incomingDocuments: RibbonDocument[],
): RibbonPullPlan {
  const incomingByKey = new Map<string, RibbonDocument>();
  for (const document of incomingDocuments) {
    const key = ribbonPullKey(document);
    if (key && !incomingByKey.has(key)) {
      incomingByKey.set(key, document);
    }
  }

  const patchesByFileUri = new Map<string, RibbonPatch[]>();
  const matchedDocuments: RibbonDocument[] = [];
  const unchangedDocuments: RibbonDocument[] = [];
  const missingDocuments: RibbonDocument[] = [];

  for (const target of targetDocuments) {
    const incoming = incomingByKey.get(ribbonPullKey(target) ?? "");
    if (!incoming) {
      missingDocuments.push(target);
      continue;
    }

    const targetXml = ribbonXml(target);
    const incomingXml = ribbonXml(incoming);
    if (targetXml === incomingXml) {
      unchangedDocuments.push(target);
      continue;
    }

    const patches = patchesByFileUri.get(target.fileUri) ?? [];
    patches.push({ kind: "replace", range: target.ribbonRange, text: incomingXml });
    patchesByFileUri.set(target.fileUri, patches);
    matchedDocuments.push(target);
  }

  return { patchesByFileUri, matchedDocuments, unchangedDocuments, missingDocuments };
}

export function ribbonPullKey(document: RibbonDocument): string | undefined {
  if (document.kind === "Application") {
    return "application";
  }

  const entity = document.entityLogicalName?.trim().toLowerCase();
  return entity ? `entity:${entity}` : undefined;
}

function ribbonXml(document: RibbonDocument): string {
  return document.sourceText.slice(document.ribbonRange.start, document.ribbonRange.end);
}
