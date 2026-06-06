import * as vscode from "vscode";
import type { LoggerPort, LogMetadata } from "@app/ports/logger";
import { formatErrorDetails } from "@shared/errorDetails";

const CHANNEL_NAME = "Dynamics 365 Tools";

export class VsCodeOutputLogger implements LoggerPort, vscode.Disposable {
  private readonly output: vscode.OutputChannel;

  constructor() {
    this.output = vscode.window.createOutputChannel(CHANNEL_NAME);
  }

  info(message: string, metadata?: LogMetadata): void {
    this.appendEntry("INFO", message, metadata);
  }

  error(message: string, error?: unknown, metadata?: LogMetadata): void {
    this.appendEntry("ERROR", message, metadata, error);
  }

  show(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.output.dispose();
  }

  private appendEntry(
    level: "INFO" | "ERROR",
    message: string,
    metadata?: LogMetadata,
    error?: unknown,
  ): void {
    this.output.appendLine("");
    this.output.appendLine(`[${new Date().toISOString()}] ${level} ${message}`);
    this.appendMetadata(metadata);

    if (error !== undefined) {
      this.output.appendLine("Error:");
      this.appendIndented(formatErrorDetails(error));
    }
  }

  private appendMetadata(metadata?: LogMetadata): void {
    const entries = Object.entries(metadata ?? {}).filter((entry) => entry[1] !== undefined);
    if (!entries.length) {
      return;
    }

    this.output.appendLine("Metadata:");
    for (const [key, value] of entries) {
      this.appendIndented(`${key}: ${formatMetadataValue(value)}`);
    }
  }

  private appendIndented(value: string): void {
    for (const line of value.split(/\r?\n/)) {
      this.output.appendLine(`  ${line}`);
    }
  }
}

function formatMetadataValue(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
