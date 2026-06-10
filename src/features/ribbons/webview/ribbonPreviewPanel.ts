import * as vscode from "vscode";
import { RibbonDocument } from "../models";
import {
  buildRibbonPreview,
  RibbonPreviewGroup,
  RibbonPreviewItem,
  RibbonPreviewModel,
} from "../ribbonPreview";
import { RibbonDocumentNode, RibbonExplorerNode, RibbonViewNode } from "../ribbonExplorer";

export class RibbonPreviewPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;

  show(node: RibbonExplorerNode): boolean {
    const target = resolveTarget(node);
    if (!target) {
      return false;
    }

    this.ensurePanel();
    if (!this.panel) {
      return false;
    }

    this.panel.title = target.title;
    this.panel.webview.html = renderHtml(target.title, target.models);
    return true;
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private ensurePanel(): void {
    if (this.panel) {
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "dynamics365Tools.ribbonPreview",
      "Ribbon Preview",
      vscode.ViewColumn.Beside,
      { enableScripts: false },
    );
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }
}

interface PreviewTarget {
  title: string;
  models: RibbonPreviewModel[];
}

function resolveTarget(node: RibbonExplorerNode): PreviewTarget | undefined {
  if (node instanceof RibbonViewNode) {
    return {
      title: `Ribbon Preview — ${node.view.scope}`,
      models: [buildRibbonPreview(node.view, node.document.entityLogicalName)],
    };
  }

  if (node instanceof RibbonDocumentNode) {
    return {
      title: `Ribbon Preview — ${documentTitle(node.document)}`,
      models: node.document.views.map((view) =>
        buildRibbonPreview(view, node.document.entityLogicalName),
      ),
    };
  }

  return undefined;
}

function documentTitle(document: RibbonDocument): string {
  return document.kind === "Application" ? "Application" : (document.entityLogicalName ?? "Entity");
}

function renderHtml(title: string, models: RibbonPreviewModel[]): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      margin: 0;
      padding: 20px;
    }
    h1 {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 6px;
    }
    .note {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 14px;
    }
    .legend {
      color: var(--vscode-descriptionForeground);
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 18px;
    }
    .legend span {
      align-items: center;
      display: inline-flex;
      gap: 6px;
    }
    .swatch {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 2px;
      height: 12px;
      width: 12px;
    }
    .swatch.custom {
      border-color: var(--vscode-focusBorder);
      box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
    }
    .swatch.hidden {
      border-style: dashed;
      opacity: 0.5;
    }
    .view {
      margin-bottom: 22px;
    }
    .view-head {
      align-items: baseline;
      display: flex;
      gap: 10px;
      margin-bottom: 6px;
    }
    .scope {
      font-weight: 600;
    }
    .tab {
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
    .ribbon {
      align-items: stretch;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      display: flex;
      overflow-x: auto;
      padding: 6px 2px;
    }
    .group {
      display: flex;
      flex: 0 0 auto;
      flex-direction: column;
      padding: 2px 12px;
    }
    .group:not(:last-child) {
      border-right: 1px solid var(--vscode-panel-border);
    }
    .group-items {
      align-items: stretch;
      display: flex;
      flex: 1 1 auto;
      gap: 4px;
    }
    .group-label {
      color: var(--vscode-descriptionForeground);
      font-size: 0.78em;
      margin-top: 8px;
      text-align: center;
    }
    .tile {
      align-items: center;
      border: 1px solid transparent;
      border-radius: 3px;
      display: inline-flex;
      gap: 6px;
      padding: 4px 8px;
      white-space: nowrap;
    }
    .tile .icon {
      background: var(--vscode-descriptionForeground);
      border-radius: 2px;
      color: var(--vscode-editorWidget-background);
      display: inline-flex;
      flex: 0 0 auto;
      font-size: 11px;
      height: 18px;
      justify-content: center;
      line-height: 18px;
      text-align: center;
      width: 18px;
    }
    .tile .caption {
      font-size: 0.88em;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .tile.custom {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }
    .tile.custom .icon {
      background: var(--vscode-focusBorder);
    }
    .tile.custom .caption {
      font-weight: 600;
    }
    .tile.hidden {
      opacity: 0.45;
    }
    .tile.hidden .caption {
      text-decoration: line-through;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="note">Standard buttons are drawn from the built-in catalog; your custom buttons are highlighted and slotted in by sequence.</div>
  <div class="legend">
    <span><span class="swatch"></span> Standard button</span>
    <span><span class="swatch custom"></span> Custom button</span>
    <span><span class="swatch hidden"></span> Hidden</span>
  </div>
  ${models.map(renderModel).join("")}
</body>
</html>`;
}

function renderModel(model: RibbonPreviewModel): string {
  const head = `<div class="view-head"><span class="scope">${escapeHtml(model.scope)}</span><span class="tab">${escapeHtml(model.tabLabel)}</span></div>`;

  if (model.isEmpty) {
    return `<div class="view">${head}<div class="empty">Nothing to preview for this command bar.</div></div>`;
  }

  return `<div class="view">${head}<div class="ribbon">${model.groups.map(renderGroup).join("")}</div></div>`;
}

function renderGroup(group: RibbonPreviewGroup): string {
  return `<div class="group">
    <div class="group-items">${group.items.map(renderTile).join("")}</div>
    <div class="group-label">${escapeHtml(group.label)}</div>
  </div>`;
}

function renderTile(item: RibbonPreviewItem): string {
  const classes = ["tile", item.source, item.hidden ? "hidden" : ""].filter(Boolean).join(" ");
  return `<span class="${classes}" title="${escapeHtml(tileTooltip(item))}"><span class="icon">${glyph(item.kind)}</span><span class="caption">${escapeHtml(item.label)}</span></span>`;
}

function tileTooltip(item: RibbonPreviewItem): string {
  const lines = [item.hidden ? `${item.label} (hidden)` : item.label];
  if (item.commandId) {
    lines.push(`Command: ${item.commandId}`);
  }
  if (item.controlId && item.controlId !== item.commandId) {
    lines.push(`Control: ${item.controlId}`);
  }
  if (item.tooltip && item.tooltip !== item.label) {
    lines.push(item.tooltip);
  }
  if (typeof item.sequence === "number") {
    lines.push(`Sequence: ${item.sequence}`);
  }
  if (item.imageName) {
    lines.push(`Icon: ${item.imageName}`);
  }
  return lines.join("\n");
}

function glyph(kind: RibbonPreviewItem["kind"]): string {
  switch (kind) {
    case "Group":
      return "▤";
    case "Tab":
      return "▭";
    case "MenuSection":
      return "☰";
    case "Unknown":
      return "?";
    case "Button":
      return "▣";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
