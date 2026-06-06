import * as path from "path";
import type { WorkspaceFilesPort } from "@app/ports/files";
import { NoopNotificationService, NotificationPort } from "@app/ports/notifications";
import { NoopOutputPort, OutputChannelPort, OutputPort } from "@app/ports/output";
import type { CancellationTokenLike } from "@app/ports/progress";
import { ConfigurationService } from "../config/configurationService";
import { EnvironmentConfig } from "../config/domain/models";
import type { DataverseClient } from "../dataverse/dataverseClient";
import { EnvironmentConnectionService } from "../dataverse/environmentConnectionService";
import { SolutionImportError, SolutionImportService } from "../dataverse/solutionImportService";
import { PcfControlProject } from "./models";
import { PcfTelemetryService } from "./pcfTelemetry";
import { PcfWorkspaceSettingsService } from "./pcfWorkspaceSettings";

export interface PcfDeployOptions {
  overwriteUnmanagedCustomizations?: boolean;
  publishWorkflows?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  token?: CancellationTokenLike;
}

export interface PcfDeployResult {
  zipPath: string;
  importJobId: string;
  asyncOperationId?: string;
  customControlIds: string[];
  durationMs: number;
}

interface CustomControlListResponse {
  value?: Array<{
    customcontrolid?: string;
    customControlId?: string;
    name?: string;
  }>;
}

export class PcfDeployService {
  private readonly output: OutputChannelPort;

  constructor(
    private readonly connections: EnvironmentConnectionService,
    private readonly settings: PcfWorkspaceSettingsService,
    private readonly configuration: ConfigurationService,
    private readonly files: WorkspaceFilesPort,
    private readonly notifications: NotificationPort = new NoopNotificationService(),
    private readonly telemetry?: PcfTelemetryService,
    output: OutputPort = new NoopOutputPort(),
  ) {
    this.output = output.createChannel("PCF Deploy");
  }

  async deployLastPackage(
    project: PcfControlProject,
    env: EnvironmentConfig,
    options: PcfDeployOptions = {},
  ): Promise<PcfDeployResult | undefined> {
    const stored = (await this.settings.getProjectSettings(project)).lastPackagedZip;
    if (!stored) {
      await this.notifications.warning(
        `No packaged solution is saved for ${project.fullName}. Package it first.`,
      );
      return undefined;
    }

    const zipPath = this.configuration.resolveLocalPath(stored);
    let zipBytes: Uint8Array;
    try {
      zipBytes = await this.files.readFile(zipPath);
    } catch {
      await this.notifications.error(`Packaged solution was not found: ${zipPath}.`);
      return undefined;
    }

    const client = await this.connections.createClient(env);
    if (!client) {
      return undefined;
    }

    const importer = new SolutionImportService(client);
    this.output.show(true);
    this.output.appendLine("");
    this.output.appendLine(
      `[${new Date().toISOString()}] Deploy ${project.fullName} to ${env.name} (${env.url})`,
    );
    this.output.appendLine(`Package: ${zipPath}`);

    try {
      const importResult = await importer.importSolution(zipBytes, {
        overwriteUnmanagedCustomizations: options.overwriteUnmanagedCustomizations ?? false,
        publishWorkflows: options.publishWorkflows ?? true,
        timeoutMs: options.timeoutMs,
        pollIntervalMs: options.pollIntervalMs,
        token: options.token,
        onStatus: (message) => this.output.appendLine(`  ${message}`),
      });
      this.output.appendLine(`Import job: ${importResult.importJobId}`);
      if (importResult.asyncOperationId) {
        this.output.appendLine(`Async operation: ${importResult.asyncOperationId}`);
      }

      const customControlIds = await this.findCustomControlIds(client, project.fullName);
      if (customControlIds.length) {
        this.output.appendLine(`Publishing ${customControlIds.length} custom control(s)`);
        await importer.publishCustomControls(customControlIds);
      } else {
        this.output.appendLine(`No deployed custom control record found for ${project.fullName}`);
      }

      await this.settings.updateProjectSettings(project, { lastDeployedEnv: env.name });
      this.telemetry?.deploy(project, true, importResult.durationMs);
      await this.notifications.info(
        `PCF solution ${path.basename(zipPath)} deployed to ${env.name}.`,
      );

      return {
        zipPath,
        importJobId: importResult.importJobId,
        asyncOperationId: importResult.asyncOperationId,
        customControlIds,
        durationMs: importResult.durationMs,
      };
    } catch (error) {
      const message = describeDeployError(error);
      this.output.appendLine(`Deploy failed: ${message}`);
      this.telemetry?.deploy(project, false);
      await this.notifications.error(`PCF deploy failed for ${project.fullName}: ${message}`);
      return undefined;
    }
  }

  dispose(): void {
    this.output.dispose();
  }

  private async findCustomControlIds(client: DataverseClient, fullName: string): Promise<string[]> {
    const response = await client.get<CustomControlListResponse>(
      `/customcontrols?$select=customcontrolid,name&$filter=name eq '${escapeODataString(fullName)}'`,
    );

    return (response.value ?? [])
      .map((record) => record.customcontrolid ?? record.customControlId)
      .filter((id): id is string => Boolean(id?.trim()))
      .map((id) => id.replace(/[{}]/g, "").trim());
  }
}

function describeDeployError(error: unknown): string {
  if (error instanceof SolutionImportError && error.errors.length) {
    return error.errors.join("; ");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}
