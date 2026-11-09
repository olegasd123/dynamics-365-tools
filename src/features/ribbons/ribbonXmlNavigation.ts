import { TextRange, XmlElementRange } from "./models";
import {
  RibbonDocumentNode,
  RibbonExplorerNode,
  RibbonItemEditTarget,
  RibbonItemNode,
  RibbonSectionNode,
  RibbonViewNode,
} from "./ribbonExplorer";
import { scanXmlElements } from "./ribbonXmlReader";

export function ribbonXmlTarget(
  node: RibbonExplorerNode | undefined,
): RibbonItemEditTarget | undefined {
  if (node instanceof RibbonItemNode) {
    const target = node.editTarget;
    if (!target) {
      return undefined;
    }

    const containers: Record<string, string> = {
      d365RibbonActions: "Actions",
      d365RibbonEnableRuleRefs: "EnableRules",
      d365RibbonDisplayRuleRefs: "DisplayRules",
    };
    const container = containers[node.contextValue];
    return container ? childTarget(target, [container]) : target;
  }

  if (
    node instanceof RibbonDocumentNode ||
    node instanceof RibbonViewNode ||
    node instanceof RibbonSectionNode
  ) {
    const target = { document: node.document, range: node.document.ribbonRange };
    if (!(node instanceof RibbonSectionNode)) {
      return target;
    }

    const paths: Record<RibbonSectionNode["kind"], string[]> = {
      customActions: ["CustomActions"],
      hideActions: ["CustomActions"],
      commandDefinitions: ["CommandDefinitions"],
      enableRules: ["RuleDefinitions", "EnableRules"],
      displayRules: ["RuleDefinitions", "DisplayRules"],
      locLabels: ["LocLabels"],
      templates: ["Templates"],
      unknownXml: [],
    };
    return childTarget(target, paths[node.kind]);
  }

  return undefined;
}

function childTarget(target: RibbonItemEditTarget, names: string[]): RibbonItemEditTarget {
  const path = elementPath(scanXmlElements(target.document.sourceText), target.range);
  let element = path?.[path.length - 1];
  for (const name of names) {
    const child = element?.children.find((item) => item.name === name);
    if (!child) {
      break;
    }
    element = child;
  }
  return { document: target.document, range: element?.range ?? target.range };
}

export function resolveRibbonXmlRange(
  sourceText: string,
  range: TextRange,
  currentText: string,
): TextRange | undefined {
  if (sourceText === currentText) {
    return range;
  }

  let originalSiblings = scanXmlElements(sourceText);
  const path = elementPath(originalSiblings, range);
  if (!path) {
    return undefined;
  }

  let currentSiblings = scanXmlElements(currentText);
  let match: XmlElementRange | undefined;
  for (const original of path) {
    const originalMatches = originalSiblings.filter((item) =>
      sameElementIdentity(original, item, sourceText, sourceText),
    );
    const currentMatches = currentSiblings.filter((item) =>
      sameElementIdentity(original, item, sourceText, currentText),
    );
    // Never guess between duplicate elements or select an unsaved new item's sibling.
    if (originalMatches.length !== 1 || currentMatches.length !== 1) {
      return undefined;
    }

    match = currentMatches[0];
    if (
      sourceText.slice(original.range.start, original.range.end) ===
      currentText.slice(match.range.start, match.range.end)
    ) {
      const shift = match.range.start - original.range.start;
      return { start: range.start + shift, end: range.end + shift };
    }
    originalSiblings = original.children;
    currentSiblings = match.children;
  }

  return match?.range;
}

function elementPath(elements: XmlElementRange[], range: TextRange): XmlElementRange[] | undefined {
  for (const element of elements) {
    if (element.range.start === range.start && element.range.end === range.end) {
      return [element];
    }
    if (element.range.start <= range.start && element.range.end >= range.end) {
      const children = elementPath(element.children, range);
      if (children) {
        return [element, ...children];
      }
    }
  }
  return undefined;
}

function sameElementIdentity(
  original: XmlElementRange,
  candidate: XmlElementRange,
  sourceText: string,
  currentText: string,
): boolean {
  if (original.name !== candidate.name) {
    return false;
  }

  const key = original.attributes.find((attribute) =>
    ["Id", "HideActionId", "languagecode"].includes(attribute.name),
  );
  if (key) {
    return candidate.attributes.some(
      (attribute) => attribute.name === key.name && attribute.value === key.value,
    );
  }

  // Flat customizations.xml files can contain the same ribbon IDs in many entities.
  if (original.name === "Entity") {
    const originalName = original.children.find((child) => child.name === "Name");
    const candidateName = candidate.children.find((child) => child.name === "Name");
    if (originalName || candidateName) {
      return !!(
        originalName &&
        candidateName &&
        sourceText.slice(originalName.innerRange.start, originalName.innerRange.end).trim() ===
          currentText.slice(candidateName.innerRange.start, candidateName.innerRange.end).trim()
      );
    }
  }

  return (
    original.attributes.length === candidate.attributes.length &&
    original.attributes.every((attribute) =>
      candidate.attributes.some(
        (other) => other.name === attribute.name && other.value === attribute.value,
      ),
    )
  );
}
