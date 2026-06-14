import {
  RibbonDocumentNode,
  RibbonExplorerNode,
  RibbonItemNode,
  RibbonSectionNode,
  RibbonViewNode,
} from "../ribbonExplorer";
import { CommandDefinition, LocLabel, RibbonDocument, RibbonScope, RibbonView } from "../models";
import { collectRibbonControls, ribbonControlId } from "../ribbonControlTree";

export function resolveRibbonTarget(
  node: RibbonExplorerNode | undefined,
): { document: RibbonDocument; view: RibbonView } | undefined {
  if (node instanceof RibbonViewNode) {
    return { document: node.document, view: node.view };
  }

  if (node instanceof RibbonSectionNode) {
    return { document: node.document, view: node.view };
  }

  if (node instanceof RibbonDocumentNode && node.document.kind === "Application") {
    return { document: node.document, view: node.document.views[0] };
  }

  return undefined;
}

export function resolveCommandTarget(
  node: RibbonExplorerNode | undefined,
): { document: RibbonDocument; command: CommandDefinition } | undefined {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    return undefined;
  }

  if (
    !node.contextValue.includes("d365RibbonCommandDefinition") &&
    node.contextValue !== "d365RibbonActions" &&
    node.contextValue !== "d365RibbonEnableRuleRefs" &&
    node.contextValue !== "d365RibbonDisplayRuleRefs"
  ) {
    return undefined;
  }

  for (const view of node.editTarget.document.views) {
    const command = view.commandDefinitions.find(
      (item) =>
        item.range.start === node.editTarget?.range.start &&
        item.range.end === node.editTarget.range.end,
    );
    if (command) {
      return { document: node.editTarget.document, command };
    }
  }

  return undefined;
}

export function resolveLocLabelTarget(
  node: RibbonExplorerNode | undefined,
): { document: RibbonDocument; label: LocLabel } | undefined {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    return undefined;
  }

  if (
    node.contextValue !== "d365RibbonLocLabel" &&
    node.contextValue !== "d365RibbonLocLabelTitle"
  ) {
    return undefined;
  }

  const target = node.editTarget;
  for (const view of target.document.views) {
    const label = view.locLabels.find(
      (item) =>
        sameRange(item.range, target.range) ||
        item.titles.some((title) => sameRange(title.range, target.range)),
    );
    if (label) {
      return { document: target.document, label };
    }
  }

  return undefined;
}

export function inferRibbonScope(location: string): RibbonScope | undefined {
  const match = /^Mscrm\.(Form|HomepageGrid|SubGrid)\./.exec(location);
  return match ? (match[1] as RibbonScope) : undefined;
}

export function sameRange(
  left: { start: number; end: number },
  right: { start: number; end: number },
) {
  return left.start === right.start && left.end === right.end;
}

export function nextCustomActionSequence(view: RibbonView): number {
  const sequences = view.customActions
    .map((action) => action.sequence)
    .filter((sequence): sequence is number => typeof sequence === "number");
  return sequences.length ? Math.max(...sequences) + 10 : 10;
}

export function validateUniqueId(
  document: RibbonDocument,
  value: string,
  requiredMessage: string,
  allowedId?: string,
): string | undefined {
  const id = value.trim();
  if (!id) {
    return requiredMessage;
  }

  if (allowedId && id === allowedId) {
    return undefined;
  }

  const used = new Set<string>();
  for (const view of document.views) {
    for (const action of view.customActions) {
      used.add(action.id);
      if (action.commandUI && action.commandUI.kind !== "Unknown") {
        for (const control of collectRibbonControls(action.commandUI)) {
          if (control.kind !== "Unknown") {
            used.add(ribbonControlId(control));
          }
        }
      }
    }
    for (const action of view.hideActions) {
      used.add(action.hideActionId);
    }
    for (const command of view.commandDefinitions) {
      used.add(command.id);
    }
    for (const rule of view.enableRules) {
      used.add(rule.id);
    }
    for (const rule of view.displayRules) {
      used.add(rule.id);
    }
    for (const label of view.locLabels) {
      used.add(label.id);
    }
  }

  return used.has(id) ? "This id already exists in this ribbon." : undefined;
}

export function collectRibbonIds(document: RibbonDocument): Set<string> {
  const used = new Set<string>();
  for (const view of document.views) {
    for (const action of view.customActions) {
      used.add(action.id);
      if (action.commandUI && action.commandUI.kind !== "Unknown") {
        for (const control of collectRibbonControls(action.commandUI)) {
          if (control.kind !== "Unknown") {
            used.add(ribbonControlId(control));
          }
        }
      }
    }
    for (const action of view.hideActions) {
      used.add(action.hideActionId);
    }
    for (const command of view.commandDefinitions) {
      used.add(command.id);
    }
    for (const rule of view.enableRules) {
      used.add(rule.id);
    }
    for (const rule of view.displayRules) {
      used.add(rule.id);
    }
    for (const label of view.locLabels) {
      used.add(label.id);
    }
  }

  return used;
}

export function nextBatchId(used: Set<string>, id: string): string {
  if (!used.has(id)) {
    used.add(id);
    return id;
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${id}.${index}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}
