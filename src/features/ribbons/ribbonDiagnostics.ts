import * as vscode from "vscode";
import { RibbonDocument, TextRange } from "./models";
import { validateRibbonDocument } from "./ribbonValidator";

export class RibbonDiagnosticsService implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("d365-ribbons");

  validateDocuments(documents: RibbonDocument[]): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const document of documents) {
      const diagnostics = byFile.get(document.fileUri) ?? [];
      diagnostics.push(
        ...validateRibbonDocument(document).map(
          (issue) =>
            new vscode.Diagnostic(
              toVsCodeRange(document.sourceText, issue.range),
              issue.message,
              issue.severity === "error"
                ? vscode.DiagnosticSeverity.Error
                : vscode.DiagnosticSeverity.Warning,
            ),
        ),
      );
      byFile.set(document.fileUri, diagnostics);
    }

    this.diagnostics.clear();
    for (const [fileUri, diagnostics] of byFile.entries()) {
      this.diagnostics.set(vscode.Uri.file(fileUri), diagnostics);
    }
  }

  clear(): void {
    this.diagnostics.clear();
  }

  dispose(): void {
    this.diagnostics.dispose();
  }
}

function toVsCodeRange(sourceText: string, range: TextRange): vscode.Range {
  const start = toPosition(sourceText, range.start);
  const end = toPosition(sourceText, Math.max(range.start + 1, range.end));
  return new vscode.Range(start, end);
}

function toPosition(sourceText: string, offset: number): vscode.Position {
  const safeOffset = Math.max(0, Math.min(offset, sourceText.length));
  let line = 0;
  let lineStart = 0;

  for (let index = 0; index < safeOffset; index += 1) {
    if (sourceText[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }

  return new vscode.Position(line, safeOffset - lineStart);
}
