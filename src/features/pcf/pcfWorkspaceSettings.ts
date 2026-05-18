import * as path from "path";
import * as vscode from "vscode";
import { ConfigurationService } from "../config/configurationService";
import { PcfControlProject, PcfWorkspaceProjectSettings, PcfWorkspaceSettings } from "./models";

const SETTINGS_FILENAME = "dynamics365tools.pcf.json";

export class PcfWorkspaceSettingsService {
  constructor(private readonly configuration: ConfigurationService) {}

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
    const uri = this.getSettingsUri();
    if (!(await exists(uri))) {
      return emptySettings();
    }

    const content = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(content.toString()) as unknown;
    return normalizeSettings(parsed);
  }

  async save(settings: PcfWorkspaceSettings): Promise<void> {
    const uri = this.getSettingsUri();
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(settings, null, 2), "utf8"),
    );
  }

  projectKey(project: PcfControlProject): string {
    return normalizeSlashes(this.configuration.getRelativeToWorkspace(project.rootUri));
  }

  private getSettingsUri(): vscode.Uri {
    if (!this.configuration.workspaceRoot) {
      throw new Error("This extension requires an opened workspace folder.");
    }

    return vscode.Uri.joinPath(
      vscode.Uri.file(this.configuration.workspaceRoot),
      ".vscode",
      SETTINGS_FILENAME,
    );
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

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
