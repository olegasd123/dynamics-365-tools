import { EnvironmentConfig } from "../config/domain/models";
import { EnvironmentConnectionService } from "../dataverse/environmentConnectionService";
import {
  SolutionComponentService,
  SolutionComponentType,
} from "../dataverse/solutionComponentService";
import { DeployedPcfControl, PcfControlProject } from "./models";

interface DataverseGetClient {
  get<T>(path: string): Promise<T>;
}

interface PcfSolutionComponentReader {
  listComponentIdsForSolutions(
    componentType: SolutionComponentType,
    solutionNames: string[],
  ): Promise<Set<string>>;
}

export interface PcfEnvironmentListOptions {
  solutionNames?: string[];
  workspaceProjects?: PcfControlProject[];
}

interface CustomControlRecord {
  customcontrolid?: string;
  customControlId?: string;
  name?: string;
  version?: string;
  ismanaged?: boolean;
  isManaged?: boolean;
}

export class PcfEnvironmentService {
  constructor(private readonly connections: EnvironmentConnectionService) {}

  async listControls(
    env: EnvironmentConfig,
    options: PcfEnvironmentListOptions = {},
  ): Promise<DeployedPcfControl[] | undefined> {
    const client = await this.connections.createClient(env);
    if (!client) {
      return undefined;
    }

    const solutionComponents = new SolutionComponentService(client);
    return listDeployedPcfControls(client, solutionComponents, options);
  }
}

export async function listDeployedPcfControls(
  client: DataverseGetClient,
  solutionComponents: PcfSolutionComponentReader,
  options: PcfEnvironmentListOptions = {},
): Promise<DeployedPcfControl[]> {
  const controls = await fetchControls(client);
  const filtered = await filterBySolutions(controls, solutionComponents, options.solutionNames);
  const projectsByName = new Map(
    (options.workspaceProjects ?? []).map((project) => [project.fullName.toLowerCase(), project]),
  );

  return filtered
    .map((control) => ({
      ...control,
      workspaceMatch: projectsByName.get(control.name.toLowerCase()),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

async function fetchControls(client: DataverseGetClient): Promise<DeployedPcfControl[]> {
  const response = await client.get<{ value?: CustomControlRecord[] }>(
    "/customcontrols?$select=customcontrolid,name,version,ismanaged&$orderby=name",
  );

  return (response.value ?? [])
    .map(mapControl)
    .filter((control): control is DeployedPcfControl => Boolean(control));
}

async function filterBySolutions(
  controls: DeployedPcfControl[],
  solutionComponents: PcfSolutionComponentReader,
  solutionNames?: string[],
): Promise<DeployedPcfControl[]> {
  const names = solutionNames?.map((name) => name.trim()).filter(Boolean);
  if (!names?.length) {
    return controls;
  }

  const ids = await solutionComponents.listComponentIdsForSolutions(
    SolutionComponentType.CustomControl,
    names,
  );
  if (!ids.size) {
    return [];
  }

  return controls.filter((control) => ids.has(normalizeGuid(control.customControlId)));
}

function mapControl(record: CustomControlRecord): DeployedPcfControl | undefined {
  const customControlId = readString(record.customcontrolid) ?? readString(record.customControlId);
  const name = readString(record.name) ?? customControlId;
  if (!customControlId || !name) {
    return undefined;
  }

  return {
    customControlId: normalizeGuid(customControlId),
    name,
    version: readString(record.version) ?? "",
    managed: Boolean(record.ismanaged ?? record.isManaged),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeGuid(value: string): string {
  return value.replace(/[{}]/g, "");
}
