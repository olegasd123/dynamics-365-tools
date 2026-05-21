import { HideAction, RibbonDocument, RibbonPatch, TextRange, XmlElementRange } from "./models";
import { scanXmlElements } from "./ribbonXmlReader";

export interface NewHideActionInput {
  hideActionId: string;
  location: string;
}

export function createDeleteNodePatch(sourceText: string, range: TextRange): RibbonPatch {
  return { kind: "delete", range: expandToLineRange(sourceText, range) };
}

export function createHideActionPatches(
  document: RibbonDocument,
  input: NewHideActionInput,
): RibbonPatch[] {
  const ribbon = findDocumentRibbon(document);
  const customActions = ribbon.children.find((child) => child.name === "CustomActions");
  const nodeText = renderHideAction(input);

  if (!customActions) {
    const ribbonIndent = indentationBefore(document.sourceText, ribbon.range.start);
    const sectionIndent = `${ribbonIndent}  `;
    const childIndent = `${sectionIndent}  `;
    return [
      {
        kind: "insert",
        offset: ribbon.startTagRange.end,
        text: `\n${sectionIndent}<CustomActions>\n${childIndent}${nodeText}\n${sectionIndent}</CustomActions>`,
      },
    ];
  }

  const sectionIndent = indentationBefore(document.sourceText, customActions.range.start);
  const childIndent = findChildIndent(document.sourceText, customActions) ?? `${sectionIndent}  `;

  if (customActions.selfClosing) {
    return [
      {
        kind: "replace",
        range: customActions.range,
        text: `<CustomActions>\n${childIndent}${nodeText}\n${sectionIndent}</CustomActions>`,
      },
    ];
  }

  if (!customActions.children.length) {
    return [
      {
        kind: "replace",
        range: customActions.innerRange,
        text: `\n${childIndent}${nodeText}\n${sectionIndent}`,
      },
    ];
  }

  const lastChild = customActions.children[customActions.children.length - 1];
  return [{ kind: "insert", offset: lastChild.range.end, text: `\n${childIndent}${nodeText}` }];
}

export function nextHideActionId(
  document: RibbonDocument,
  hideAction: Pick<HideAction, "hideActionId">,
): string {
  const used = new Set(
    document.views.flatMap((view) => view.hideActions.map((item) => item.hideActionId)),
  );
  if (!used.has(hideAction.hideActionId)) {
    return hideAction.hideActionId;
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${hideAction.hideActionId}.${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

export function makeHideActionId(
  document: RibbonDocument,
  scope: string,
  commandId: string,
): string {
  const owner = document.entityLogicalName ?? "application";
  return `d365tools.${sanitizeIdPart(owner)}.${sanitizeIdPart(scope)}.Hide.${sanitizeIdPart(commandId)}`;
}

function findDocumentRibbon(document: RibbonDocument): XmlElementRange {
  const roots = scanXmlElements(document.sourceText);
  const ribbons = collectElements(roots, "RibbonDiffXml");
  const ribbon = ribbons.find(
    (node) =>
      node.range.start === document.ribbonRange.start &&
      node.range.end === document.ribbonRange.end,
  );

  if (!ribbon) {
    throw new Error("RibbonDiffXml range was not found in the current document text.");
  }

  return ribbon;
}

function collectElements(nodes: XmlElementRange[], name: string): XmlElementRange[] {
  const matches: XmlElementRange[] = [];

  for (const node of nodes) {
    if (node.name === name) {
      matches.push(node);
    }
    matches.push(...collectElements(node.children, name));
  }

  return matches;
}

function renderHideAction(input: NewHideActionInput): string {
  return `<HideCustomAction HideActionId="${escapeXmlAttribute(input.hideActionId)}" Location="${escapeXmlAttribute(input.location)}" />`;
}

function expandToLineRange(sourceText: string, range: TextRange): TextRange {
  let start = range.start;
  let end = range.end;

  while (start > 0 && sourceText[start - 1] !== "\n" && isWhitespace(sourceText[start - 1])) {
    start -= 1;
  }

  while (end < sourceText.length && isWhitespace(sourceText[end])) {
    const char = sourceText[end];
    end += 1;
    if (char === "\n") {
      break;
    }
  }

  return { start, end };
}

function indentationBefore(sourceText: string, offset: number): string {
  const lineStart = sourceText.lastIndexOf("\n", offset - 1) + 1;
  const text = sourceText.slice(lineStart, offset);
  return /^\s*$/.test(text) ? text : "";
}

function findChildIndent(sourceText: string, node: XmlElementRange): string | undefined {
  const child = node.children[0];
  if (!child) {
    return undefined;
  }

  return indentationBefore(sourceText, child.range.start);
}

function isWhitespace(value: string): boolean {
  return value === " " || value === "\t" || value === "\r" || value === "\n";
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, ".");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
