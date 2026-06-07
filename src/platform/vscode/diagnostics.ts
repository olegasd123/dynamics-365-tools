import * as vscode from "vscode";
import type { DiagnosticEntry, DiagnosticPort } from "@app/ports/diagnostics";
import { DiagnosticSeverity } from "@app/ports/diagnostics";

export class VsCodeDiagnostics implements DiagnosticPort {
  private readonly collection: vscode.DiagnosticCollection;

  constructor(name: string) {
    this.collection = vscode.languages.createDiagnosticCollection(name);
  }

  set(filePath: string, diagnostics: DiagnosticEntry[]): void {
    this.collection.set(
      vscode.Uri.file(filePath),
      diagnostics.map((diagnostic) => toVsCodeDiagnostic(diagnostic)),
    );
  }

  delete(filePath: string): void {
    this.collection.delete(vscode.Uri.file(filePath));
  }

  dispose(): void {
    this.collection.dispose();
  }
}

function toVsCodeDiagnostic(diagnostic: DiagnosticEntry): vscode.Diagnostic {
  return new vscode.Diagnostic(
    new vscode.Range(
      new vscode.Position(diagnostic.range.start.line, diagnostic.range.start.character),
      new vscode.Position(diagnostic.range.end.line, diagnostic.range.end.character),
    ),
    diagnostic.message,
    toVsCodeSeverity(diagnostic.severity),
  );
}

function toVsCodeSeverity(severity: DiagnosticSeverity): vscode.DiagnosticSeverity {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return vscode.DiagnosticSeverity.Error;
  }
}
