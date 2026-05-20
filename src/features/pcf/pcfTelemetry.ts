import * as vscode from "vscode";
import { PcfControlProject } from "./models";

type TelemetryData = Record<string, string | number | boolean | undefined>;

export class PcfTelemetryService implements vscode.Disposable {
  private readonly logger: vscode.TelemetryLogger;

  constructor() {
    this.logger = vscode.env.createTelemetryLogger({
      sendEventData: () => undefined,
      sendErrorData: () => undefined,
    });
  }

  build(project: PcfControlProject, success: boolean, durationMs?: number): void {
    this.event("pcf.build", {
      success,
      controlType: project.controlType,
      templateKind: project.templateKind,
      hasNodeModules: project.hasNodeModules,
      durationMs,
    });
  }

  push(project: PcfControlProject, success: boolean, durationMs?: number): void {
    this.event("pcf.push", {
      success,
      controlType: project.controlType,
      templateKind: project.templateKind,
      durationMs,
    });
  }

  package(
    project: PcfControlProject,
    success: boolean,
    managed: boolean,
    durationMs?: number,
  ): void {
    this.event("pcf.package", {
      success,
      managed,
      controlType: project.controlType,
      templateKind: project.templateKind,
      durationMs,
    });
  }

  deploy(project: PcfControlProject, success: boolean, durationMs?: number): void {
    this.event("pcf.deploy", {
      success,
      controlType: project.controlType,
      templateKind: project.templateKind,
      durationMs,
    });
  }

  dispose(): void {
    this.logger.dispose();
  }

  private event(name: string, data: TelemetryData): void {
    this.logger.logUsage(name, compact(data));
  }
}

function compact(data: TelemetryData): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(data).filter(
      (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
    ),
  );
}
