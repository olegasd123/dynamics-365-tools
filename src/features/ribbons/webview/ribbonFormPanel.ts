import * as vscode from "vscode";
import {
  RibbonDocumentNode,
  RibbonEmptyNode,
  RibbonExplorerNode,
  RibbonItemNode,
  RibbonSectionNode,
  RibbonSourceNode,
  RibbonViewNode,
} from "../ribbonExplorer";

export class RibbonFormPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;

  show(node: RibbonExplorerNode): void {
    this.ensurePanel();
    if (!this.panel) {
      return;
    }

    this.panel.title = panelTitle(node);
    this.panel.webview.html = renderHtml(node);
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private ensurePanel(): void {
    if (this.panel) {
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "dynamics365Tools.ribbonForm",
      "Ribbon Details",
      vscode.ViewColumn.Beside,
      { enableScripts: false },
    );
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }
}

function panelTitle(node: RibbonExplorerNode): string {
  if (node instanceof RibbonSourceNode) {
    return "Ribbon Source";
  }
  if (node instanceof RibbonDocumentNode) {
    return "Ribbon Document";
  }
  if (node instanceof RibbonViewNode) {
    return "Ribbon View";
  }
  if (node instanceof RibbonSectionNode) {
    return "Ribbon Section";
  }
  if (node instanceof RibbonItemNode) {
    return "Ribbon Item";
  }

  return "Ribbon Details";
}

function renderHtml(node: RibbonExplorerNode): string {
  const title = escapeHtml(String(node.label ?? "Ribbon Details"));
  const description = node.description ? escapeHtml(String(node.description)) : "";
  const rows = detailRows(node);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
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
      margin: 0 0 4px;
    }
    .description {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 18px;
    }
    dl {
      display: grid;
      grid-template-columns: minmax(120px, 180px) minmax(0, 1fr);
      gap: 8px 14px;
      margin: 0;
    }
    dt {
      color: var(--vscode-descriptionForeground);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    code {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${description ? `<div class="description">${description}</div>` : ""}
  <dl>
    ${rows.map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${formatValue(value)}</dd>`).join("")}
  </dl>
</body>
</html>`;
}

function detailRows(node: RibbonExplorerNode): Array<[string, string | number | undefined]> {
  if (node instanceof RibbonSourceNode) {
    return [
      ["Type", node.source.kind],
      ["Root", node.source.rootUri],
      ["Files", node.source.files.length],
    ];
  }

  if (node instanceof RibbonDocumentNode) {
    return [
      ["Kind", node.document.kind],
      ["Entity", node.document.entityLogicalName],
      ["File", node.document.fileUri],
      ["Views", node.document.views.map((view) => view.scope).join(", ")],
    ];
  }

  if (node instanceof RibbonViewNode) {
    return [
      ["Scope", node.view.scope],
      ["Custom actions", node.view.customActions.length],
      ["Hide actions", node.view.hideActions.length],
      ["Commands", node.view.commandDefinitions.length],
      ["Enable rules", node.view.enableRules.length],
      ["Display rules", node.view.displayRules.length],
      ["Labels", node.view.locLabels.length],
    ];
  }

  if (node instanceof RibbonSectionNode) {
    return [
      ["Section", String(node.label)],
      ["Scope", node.view.scope],
      ["Items", node.count],
    ];
  }

  if (node instanceof RibbonItemNode) {
    return node.details;
  }

  if (node instanceof RibbonEmptyNode) {
    return [["Status", String(node.label)]];
  }

  return [];
}

function formatValue(value: string | number | undefined): string {
  if (value === undefined || value === "") {
    return "";
  }

  return `<code>${escapeHtml(String(value))}</code>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
