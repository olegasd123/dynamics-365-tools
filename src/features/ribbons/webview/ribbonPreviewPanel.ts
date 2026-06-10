import * as vscode from "vscode";
import { RibbonDocument } from "../models";
import {
  buildRibbonPreview,
  RibbonPreviewItem,
  RibbonPreviewLocation,
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
      models: [buildRibbonPreview(node.view)],
    };
  }

  if (node instanceof RibbonDocumentNode) {
    return {
      title: `Ribbon Preview — ${documentTitle(node.document)}`,
      models: node.document.views.map(buildRibbonPreview),
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
      margin: 0 0 18px;
    }
    h2 {
      font-size: 14px;
      font-weight: 600;
      margin: 22px 0 10px;
    }
    .scope {
      color: var(--vscode-descriptionForeground);
      font-weight: 400;
    }
    .location {
      margin-bottom: 16px;
    }
    .location-label {
      font-weight: 600;
      margin-bottom: 4px;
    }
    .location-path {
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      margin-bottom: 8px;
      overflow-wrap: anywhere;
    }
    .bar {
      align-items: stretch;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px;
    }
    .chip {
      align-items: center;
      background: var(--vscode-button-secondaryBackground, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      display: inline-flex;
      gap: 6px;
      max-width: 240px;
      padding: 5px 10px;
    }
    .chip .glyph {
      flex: 0 0 auto;
    }
    .chip .label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chip.group {
      background: transparent;
      border-style: dashed;
      font-weight: 600;
    }
    .chip.tab {
      background: transparent;
      border-bottom: 2px solid var(--vscode-focusBorder);
      font-weight: 600;
    }
    .chip.hidden {
      border-style: dashed;
      opacity: 0.6;
    }
    .chip.hidden .label {
      text-decoration: line-through;
    }
    .badge {
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${models.map(renderModel).join("")}
</body>
</html>`;
}

function renderModel(model: RibbonPreviewModel): string {
  const heading = `<h2>${escapeHtml(model.scope)} <span class="scope">command bar</span></h2>`;
  if (model.isEmpty) {
    return `${heading}<div class="empty">No custom buttons or hidden buttons in this view.</div>`;
  }
  return `${heading}${model.locations.map(renderLocation).join("")}`;
}

function renderLocation(location: RibbonPreviewLocation): string {
  const chips = [
    ...location.items.map(renderItemChip),
    ...location.hidden.map((item) => renderHiddenChip(item.id)),
  ].join("");

  return `<div class="location">
    <div class="location-label">${escapeHtml(location.label)}</div>
    <div class="location-path">${escapeHtml(location.location || "(no location)")}</div>
    <div class="bar">${chips}</div>
  </div>`;
}

function renderItemChip(item: RibbonPreviewItem): string {
  const classes = `chip ${item.kind.toLowerCase()}`;
  const tooltip = chipTooltip(item);
  const image = item.imageName ? `<span class="badge" title="Icon web resource">◧</span>` : "";
  return `<span class="${classes}" title="${escapeHtml(tooltip)}">${image}<span class="glyph">${glyph(item.kind)}</span><span class="label">${escapeHtml(item.label)}</span></span>`;
}

function renderHiddenChip(id: string): string {
  return `<span class="chip hidden" title="${escapeHtml(`Hidden: ${id}`)}"><span class="glyph">⊘</span><span class="label">${escapeHtml(id)}</span></span>`;
}

function chipTooltip(item: RibbonPreviewItem): string {
  const lines = [item.label];
  if (item.commandId) {
    lines.push(`Command: ${item.commandId}`);
  }
  if (item.tooltip && item.tooltip !== item.label) {
    lines.push(item.tooltip);
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
