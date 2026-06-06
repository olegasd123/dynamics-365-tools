import * as path from "path";
import type { WorkspaceFilesPort } from "../../app/ports/files";
import { NoopTextInput, TextInputPort } from "../../app/ports/input";
import { NoopNotificationService, NotificationPort } from "../../app/ports/notifications";
import { NoopOutputPort, OutputChannelPort, OutputPort } from "../../app/ports/output";
import type { CancellationTokenLike } from "../../app/ports/progress";
import { XMLParser } from "fast-xml-parser";
import { EnvironmentConfig } from "../config/domain/models";
import { PacCli } from "./pacCli";
import { PcfControlProject } from "./models";
import { PcfTelemetryService } from "./pcfTelemetry";
import { PcfWorkspaceSettingsService } from "./pcfWorkspaceSettings";

export class PcfPushService {
  private readonly output: OutputChannelPort;

  constructor(
    private readonly pacCli: PacCli,
    private readonly settings: PcfWorkspaceSettingsService,
    private readonly files: WorkspaceFilesPort,
    private readonly notifications: NotificationPort = new NoopNotificationService(),
    private readonly telemetry?: PcfTelemetryService,
    output: OutputPort = new NoopOutputPort(),
    private readonly input: TextInputPort = new NoopTextInput(),
  ) {
    this.output = output.createChannel("PCF Push");
  }

  async resolvePublisherPrefix(project: PcfControlProject): Promise<string | undefined> {
    const cdsPrefix = await readPublisherPrefixFromCdsProject(this.files, project.cdsProjectUri);
    if (cdsPrefix) {
      await this.settings.updateProjectSettings(project, { publisherPrefix: cdsPrefix });
      return cdsPrefix;
    }

    const stored = (await this.settings.getProjectSettings(project)).publisherPrefix;
    if (stored && validatePublisherPrefix(stored) === undefined) {
      return stored;
    }

    const entered = await this.input.showInputBox({
      prompt: `Publisher prefix for ${project.fullName}`,
      placeHolder: "new",
      value: stored,
      ignoreFocusOut: true,
      validateInput: validatePublisherPrefix,
    });
    if (!entered) {
      return undefined;
    }

    const prefix = entered.trim();
    await this.settings.updateProjectSettings(project, { publisherPrefix: prefix });
    return prefix;
  }

  async warnForAuthMismatch(
    env: EnvironmentConfig,
    token?: CancellationTokenLike,
  ): Promise<boolean> {
    const profile = await this.pacCli.whoami();
    if (profile?.url && sameEnvironmentUrl(profile.url, env.url)) {
      return true;
    }

    this.output.show(true);
    const source = profile?.url ? ` from ${profile.url}` : "";
    this.output.appendLine(`[${new Date().toISOString()}] Sync pac auth${source} to ${env.url}`);
    const result = await this.pacCli.authCreate(
      { url: env.url, name: "d365-tools" },
      (line, stream) => this.output.appendLine(stream === "stderr" ? `[stderr] ${line}` : line),
      token,
    );

    if (result.exitCode !== 0) {
      await this.notifications.error(`pac auth create failed with exit code ${result.exitCode}.`);
      return false;
    }

    await this.notifications.info(`pac auth profile synced to ${env.name}.`);
    return true;
  }

  async push(
    project: PcfControlProject,
    env: EnvironmentConfig,
    publisherPrefix: string,
    token?: CancellationTokenLike,
  ): Promise<boolean> {
    this.output.show(true);
    this.output.appendLine("");
    this.output.appendLine(
      `[${new Date().toISOString()}] Push ${project.fullName} to ${env.name} (${env.url})`,
    );
    this.output.appendLine(`Publisher prefix: ${publisherPrefix}`);

    const result = await this.pacCli.pcfPush(
      {
        environmentUrl: env.url,
        publisherPrefix,
      },
      project.rootUri,
      (line, stream) => this.output.appendLine(stream === "stderr" ? `[stderr] ${line}` : line),
      token,
    );

    this.telemetry?.push(project, result.exitCode === 0, result.durationMs);

    if (result.exitCode !== 0) {
      await this.notifications.error(`PCF push failed for ${project.fullName}.`);
      return false;
    }

    await this.settings.updateProjectSettings(project, {
      publisherPrefix,
      lastDeployedEnv: env.name,
    });
    await this.notifications.info(`PCF control ${project.fullName} pushed to ${env.name}.`);
    return true;
  }

  dispose(): void {
    this.output.dispose();
  }
}

export function validatePublisherPrefix(value: string): string | undefined {
  const prefix = value.trim();
  if (!prefix) {
    return "Publisher prefix is required.";
  }
  if (!/^[A-Za-z][A-Za-z0-9]{1,7}$/.test(prefix)) {
    return "Use 2-8 letters or numbers. Start with a letter.";
  }
  if (prefix.toLowerCase().startsWith("mscrm")) {
    return "Publisher prefix cannot start with mscrm.";
  }
  return undefined;
}

async function readPublisherPrefixFromCdsProject(
  files: WorkspaceFilesPort,
  cdsProjectUri?: string,
): Promise<string | undefined> {
  if (!cdsProjectUri) {
    return undefined;
  }

  const root = path.dirname(cdsProjectUri);
  const candidates = [
    path.join(root, "src", "Other", "Solution.xml"),
    path.join(root, "Other", "Solution.xml"),
    path.join(root, "Solution.xml"),
  ];

  for (const candidate of candidates) {
    const prefix = await readPublisherPrefix(files, candidate);
    if (prefix) {
      return prefix;
    }
  }

  return undefined;
}

async function readPublisherPrefix(
  files: WorkspaceFilesPort,
  filePath: string,
): Promise<string | undefined> {
  try {
    const content = Buffer.from(await files.readFile(filePath)).toString("utf8");
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(content) as unknown;
    const found = findKey(parsed, "CustomizationPrefix");
    return typeof found === "string" && found.trim() ? found.trim() : undefined;
  } catch {
    return undefined;
  }
}

function findKey(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, key);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (value[key] !== undefined) {
    return value[key];
  }

  for (const child of Object.values(value)) {
    const found = findKey(child, key);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function sameEnvironmentUrl(left: string, right: string): boolean {
  return normalizeEnvironmentUrl(left) === normalizeEnvironmentUrl(right);
}

function normalizeEnvironmentUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
