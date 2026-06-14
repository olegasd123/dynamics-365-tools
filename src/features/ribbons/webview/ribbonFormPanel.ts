import * as vscode from "vscode";
import {
  RibbonDocumentNode,
  RibbonEmptyNode,
  RibbonExplorerNode,
  RibbonItemNode,
  RibbonDetailValue,
  RibbonSectionNode,
  RibbonSourceNode,
  RibbonViewNode,
} from "../ribbonExplorer";

export class RibbonFormPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private messageSubscription?: vscode.Disposable;
  private currentNode?: RibbonExplorerNode;

  show(node: RibbonExplorerNode): void {
    this.currentNode = node;
    this.ensurePanel();
    if (!this.panel) {
      return;
    }

    this.panel.title = panelTitle(node);
    this.panel.webview.html = renderHtml(node, actionsForNode(node));
  }

  dispose(): void {
    this.messageSubscription?.dispose();
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
      { enableScripts: true },
    );
    this.messageSubscription = this.panel.webview.onDidReceiveMessage((message) =>
      this.handleMessage(message),
    );
    this.panel.onDidDispose(() => {
      this.messageSubscription?.dispose();
      this.messageSubscription = undefined;
      this.panel = undefined;
    });
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isRunCommandMessage(message) || !this.currentNode) {
      return;
    }

    const action = actionsForNode(this.currentNode).find(
      (item) => item.command === message.command,
    );
    if (!action) {
      return;
    }

    await vscode.commands.executeCommand(action.command, this.currentNode);
  }
}

interface PanelAction {
  command: string;
  label: string;
}

interface RunCommandMessage {
  type: "runCommand";
  command: string;
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

function renderHtml(node: RibbonExplorerNode, actions: PanelAction[]): string {
  const title = escapeHtml(String(node.label ?? "Ribbon Details"));
  const description = node.description ? escapeHtml(String(node.description)) : "";
  const rows = detailRows(node);
  const nonce = String(Date.now());

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 18px;
    }
    button {
      align-items: center;
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 2px;
      color: var(--vscode-button-foreground);
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      min-height: 28px;
      padding: 4px 10px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
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
    ul {
      margin: 0;
      padding-left: 18px;
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
  ${actions.length ? `<div class="actions">${actions.map(renderActionButton).join("")}</div>` : ""}
  <dl>
    ${rows.map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${formatValue(value)}</dd>`).join("")}
  </dl>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    for (const button of document.querySelectorAll("button[data-command]")) {
      button.addEventListener("click", () => {
        vscode.postMessage({ type: "runCommand", command: button.dataset.command });
      });
    }
  </script>
</body>
</html>`;
}

function renderActionButton(action: PanelAction): string {
  return `<button type="button" data-command="${escapeHtml(action.command)}">${escapeHtml(action.label)}</button>`;
}

function actionsForNode(node: RibbonExplorerNode): PanelAction[] {
  if (node instanceof RibbonSourceNode) {
    return node.source.kind === "flat" ? [openFileAction(), saveAction()] : [saveAction()];
  }

  if (node instanceof RibbonDocumentNode) {
    return node.document.kind === "Application"
      ? [openFileAction(), previewAction(), saveAction(), ...ribbonAddActions()]
      : [previewAction(), saveAction()];
  }

  if (node instanceof RibbonViewNode) {
    return [previewAction(), ...ribbonAddActions(), saveAction()];
  }

  if (node instanceof RibbonSectionNode) {
    return [...sectionActions(node), saveAction()];
  }

  if (node instanceof RibbonItemNode) {
    return [...itemActions(node), saveAction()];
  }

  return [];
}

function ribbonAddActions(): PanelAction[] {
  return [
    { command: "dynamics365Tools.ribbons.addSmartButton", label: "Add Item" },
    { command: "dynamics365Tools.ribbons.hideOobButton", label: "Hide OOB" },
    { command: "dynamics365Tools.ribbons.hideAndStubOobButtons", label: "Hide + Stub" },
    { command: "dynamics365Tools.ribbons.overrideOobCommand", label: "Override OOB" },
    { command: "dynamics365Tools.ribbons.addCommandDefinition", label: "Add Command" },
    { command: "dynamics365Tools.ribbons.addEnableRule", label: "Add Enable Rule" },
    { command: "dynamics365Tools.ribbons.addDisplayRule", label: "Add Display Rule" },
    { command: "dynamics365Tools.ribbons.addLocLabel", label: "Add Label" },
  ];
}

function sectionActions(node: RibbonSectionNode): PanelAction[] {
  switch (node.kind) {
    case "customActions":
      return [{ command: "dynamics365Tools.ribbons.addSmartButton", label: "Add Item" }];
    case "hideActions":
      return [{ command: "dynamics365Tools.ribbons.addHideOobButton", label: "Hide OOB" }];
    case "commandDefinitions":
      return [
        { command: "dynamics365Tools.ribbons.addCommandDefinition", label: "Add Command" },
        { command: "dynamics365Tools.ribbons.overrideOobCommand", label: "Override OOB" },
      ];
    case "enableRules":
      return [{ command: "dynamics365Tools.ribbons.addEnableRule", label: "Add Enable Rule" }];
    case "displayRules":
      return [{ command: "dynamics365Tools.ribbons.addDisplayRule", label: "Add Display Rule" }];
    case "locLabels":
      return [{ command: "dynamics365Tools.ribbons.addLocLabel", label: "Add Label" }];
    case "templates":
    case "unknownXml":
      return [];
  }
}

function itemActions(node: RibbonItemNode): PanelAction[] {
  const actions: PanelAction[] = [];

  if (isRawXmlNode(node)) {
    actions.push(openFileAction());
    return actions;
  }

  if (canEdit(node)) {
    actions.push({ command: "dynamics365Tools.ribbons.editNode", label: "Edit" });
  }
  if (canDelete(node)) {
    actions.push({ command: "dynamics365Tools.ribbons.deleteNode", label: "Delete" });
  }
  if (canMove(node)) {
    actions.push(
      { command: "dynamics365Tools.ribbons.moveUp", label: "Move Up" },
      { command: "dynamics365Tools.ribbons.moveDown", label: "Move Down" },
    );
  }
  if (
    node.contextValue === "d365RibbonCommandDefinition" ||
    node.contextValue === "d365RibbonActions"
  ) {
    actions.push({ command: "dynamics365Tools.ribbons.addCommandAction", label: "Add Action" });
  }
  if (node.contextValue === "d365RibbonCommandDefinition") {
    actions.push(
      { command: "dynamics365Tools.ribbons.addCommandEnableRuleRef", label: "Add Enable Ref" },
      { command: "dynamics365Tools.ribbons.addCommandDisplayRuleRef", label: "Add Display Ref" },
    );
  }
  if (node.contextValue === "d365RibbonLocLabel") {
    actions.push({ command: "dynamics365Tools.ribbons.addLocLabelTitle", label: "Add Language" });
  }

  return actions;
}

function isRawXmlNode(node: RibbonItemNode): boolean {
  return (
    node.contextValue === "d365RibbonTemplates" || node.contextValue === "d365RibbonUnknownXml"
  );
}

function canEdit(node: RibbonItemNode): boolean {
  return (
    node.contextValue === "d365RibbonCustomAction" ||
    node.contextValue === "d365RibbonHideAction" ||
    node.contextValue === "d365RibbonCommandDefinition" ||
    node.contextValue === "d365RibbonEnableRule" ||
    node.contextValue === "d365RibbonDisplayRule" ||
    node.contextValue === "d365RibbonLocLabel" ||
    node.contextValue === "d365RibbonJavaScriptAction" ||
    node.contextValue === "d365RibbonUrlAction" ||
    node.contextValue === "d365RibbonParameter" ||
    node.contextValue === "d365RibbonLocLabelTitle" ||
    node.contextValue.startsWith("d365RibbonRuleStep")
  );
}

function canMove(node: RibbonItemNode): boolean {
  return (
    node.contextValue === "d365RibbonCustomAction" ||
    node.contextValue === "d365RibbonHideAction" ||
    node.contextValue === "d365RibbonCommandDefinition" ||
    node.contextValue === "d365RibbonEnableRule" ||
    node.contextValue === "d365RibbonDisplayRule" ||
    node.contextValue === "d365RibbonRuleRef" ||
    node.contextValue === "d365RibbonLocLabel" ||
    node.contextValue === "d365RibbonJavaScriptAction" ||
    node.contextValue === "d365RibbonUrlAction" ||
    node.contextValue === "d365RibbonLocLabelTitle" ||
    node.contextValue.startsWith("d365RibbonRuleStep")
  );
}

function canDelete(node: RibbonItemNode): boolean {
  return (
    node.contextValue === "d365RibbonCustomAction" ||
    node.contextValue === "d365RibbonHideAction" ||
    node.contextValue === "d365RibbonCommandDefinition" ||
    node.contextValue === "d365RibbonEnableRule" ||
    node.contextValue === "d365RibbonDisplayRule" ||
    node.contextValue === "d365RibbonLocLabel" ||
    node.contextValue === "d365RibbonJavaScriptAction" ||
    node.contextValue === "d365RibbonUrlAction" ||
    node.contextValue === "d365RibbonLocLabelTitle" ||
    node.contextValue.startsWith("d365RibbonRuleStep")
  );
}

function openFileAction(): PanelAction {
  return { command: "dynamics365Tools.ribbons.openFile", label: "Open XML" };
}

function saveAction(): PanelAction {
  return { command: "dynamics365Tools.ribbons.save", label: "Save" };
}

function previewAction(): PanelAction {
  return { command: "dynamics365Tools.ribbons.preview", label: "Preview" };
}

function detailRows(node: RibbonExplorerNode): Array<[string, RibbonDetailValue]> {
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

function formatValue(value: RibbonDetailValue): string {
  if (Array.isArray(value)) {
    if (!value.length) {
      return "";
    }

    return `<ul>${value.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join("")}</ul>`;
  }

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

function isRunCommandMessage(message: unknown): message is RunCommandMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as RunCommandMessage).type === "runCommand" &&
    typeof (message as RunCommandMessage).command === "string"
  );
}
