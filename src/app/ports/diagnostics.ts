export enum DiagnosticSeverity {
  Error = "error",
}

export interface DiagnosticPosition {
  line: number;
  character: number;
}

export interface DiagnosticRange {
  start: DiagnosticPosition;
  end: DiagnosticPosition;
}

export interface DiagnosticEntry {
  range: DiagnosticRange;
  message: string;
  severity: DiagnosticSeverity;
}

export interface DiagnosticPort {
  set(filePath: string, diagnostics: DiagnosticEntry[]): void;
  delete(filePath: string): void;
  dispose(): void;
}

export class NoopDiagnosticPort implements DiagnosticPort {
  set(): void {}

  delete(): void {}

  dispose(): void {}
}
