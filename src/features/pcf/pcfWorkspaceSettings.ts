import * as path from "path";
import type { WorkspaceFilesPort } from "../../app/ports/files";
import { ConfigurationService } from "../config/configurationService";
import { PcfControlProject, PcfWorkspaceProjectSettings, PcfWorkspaceSettings } from "./models";

const SETTINGS_FILENAME = "dynamics365tools.pcf.json";

export class PcfWorkspaceSettingsService {
  constructor(
    private readonly configuration: ConfigurationService,
    private readonly files: WorkspaceFilesPort,
  ) {}

  async getProjectSettings(project: PcfControlProject): Promise<PcfWorkspaceProjectSettings> {
    const settings = await this.load();
    return settings.projects[this.projectKey(project)] ?? {};
  }

  async updateProjectSettings(
    project: PcfControlProject,
    update: Partial<PcfWorkspaceProjectSettings>,
  ): Promise<void> {
    const settings = await this.load();
    const key = this.projectKey(project);
    settings.projects[key] = {
      ...(settings.projects[key] ?? {}),
      ...update,
    };
    await this.save(settings);
  }

  async load(): Promise<PcfWorkspaceSettings> {
    const settingsPath = this.getSettingsPath();
    if (!(await this.files.exists(settingsPath))) {
      return emptySettings();
    }

    const content = await this.files.readFile(settingsPath);
    const parsed = JSON.parse(Buffer.from(content).toString("utf8")) as unknown;
    return normalizeSettings(parsed);
  }

  async save(settings: PcfWorkspaceSettings): Promise<void> {
    const settingsPath = this.getSettingsPath();
    await this.files.createDirectory(path.dirname(settingsPath));
    await this.files.writeFile(
      settingsPath,
      Buffer.from(JSON.stringify(settings, null, 2), "utf8"),
    );
  }

  projectKey(project: PcfControlProject): string {
    return normalizeSlashes(this.configuration.getRelativeToWorkspace(project.rootUri));
  }

  private getSettingsPath(): string {
    if (!this.configuration.workspaceRoot) {
      throw new Error("This extension requires an opened workspace folder.");
    }

    return path.join(this.configuration.workspaceRoot, ".vscode", SETTINGS_FILENAME);
  }
}

function normalizeSettings(value: unknown): PcfWorkspaceSettings {
  if (!isRecord(value)) {
    return emptySettings();
  }

  return {
    projects: isRecord(value.projects)
      ? Object.fromEntries(
          Object.entries(value.projects).filter(
            (entry): entry is [string, PcfWorkspaceProjectSettings] => isRecord(entry[1]),
          ),
        )
      : {},
    watchProjects: Array.isArray(value.watchProjects)
      ? value.watchProjects.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function emptySettings(): PcfWorkspaceSettings {
  return {
    projects: {},
    watchProjects: [],
  };
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
