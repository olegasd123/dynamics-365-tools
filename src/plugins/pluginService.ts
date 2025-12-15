import { DataverseClient } from "../services/dataverseClient";
import {
  SolutionComponentService,
  SolutionComponentType,
} from "../services/solutionComponentService";
import { PluginAssembly, PluginImage, PluginStep, PluginType } from "./models";

export interface AssemblyRegistrationInput {
  name: string;
  contentBase64: string;
  solutionName?: string;
  isolationMode?: number;
  sourceType?: number;
}

export class PluginService {
  constructor(
    private readonly client: DataverseClient,
    private readonly solutionComponents: SolutionComponentService,
  ) {}

  async registerAssembly(input: AssemblyRegistrationInput): Promise<string> {
    const payload = {
      name: input.name,
      content: input.contentBase64,
      sourcetype: input.sourceType ?? 0, // Database
      isolationmode: input.isolationMode ?? 2, // Sandbox
    };

    const response = await this.client.post<{ pluginassemblyid?: string }>("/pluginassemblies", payload);
    const id =
      response.pluginassemblyid || (await this.findAssemblyByName(input.name))?.id;

    if (!id) {
      throw new Error("Plugin assembly created but no identifier returned by Dataverse.");
    }

    if (input.solutionName) {
      await this.solutionComponents.ensureInSolution(
        id,
        SolutionComponentType.PluginAssembly,
        input.solutionName,
      );
    }

    return id;
  }

  async updateAssembly(id: string, contentBase64: string): Promise<void> {
    const normalizedId = this.normalizeGuid(id);
    await this.client.patch(`/pluginassemblies(${normalizedId})`, {
      content: contentBase64,
    });
  }

  async listAssemblies(): Promise<PluginAssembly[]> {
    const url =
      "/pluginassemblies?$select=pluginassemblyid,name,version,isolationmode,publickeytoken,culture,sourcetype&$orderby=name";
    const response = await this.client.get<{
      value?: Array<{
        pluginassemblyid?: string;
        name?: string;
        version?: string;
        isolationmode?: number;
        publickeytoken?: string;
        culture?: string;
        sourcetype?: number;
      }>;
    }>(url);

    return (response.value ?? [])
      .filter((item) => item.pluginassemblyid && item.name)
      .map((item) => ({
        id: this.normalizeGuid(item.pluginassemblyid!),
        name: item.name ?? "",
        version: item.version,
        isolationMode: item.isolationmode,
        publicKeyToken: item.publickeytoken,
        culture: item.culture,
        sourceType: item.sourcetype,
      }));
  }

  async listPluginTypes(assemblyId: string): Promise<PluginType[]> {
    const normalizedAssemblyId = this.normalizeGuid(assemblyId);
    const filter = encodeURIComponent(`_pluginassemblyid_value eq ${normalizedAssemblyId}`);
    const url = `/plugintypes?$select=plugintypeid,name,typename,friendlyname&$filter=${filter}`;
    const response = await this.client.get<{
      value?: Array<{
        plugintypeid?: string;
        name?: string;
        typename?: string;
        friendlyname?: string;
      }>;
    }>(url);

    return (response.value ?? [])
      .filter((item) => item.plugintypeid && item.name)
      .map((item) => ({
        id: this.normalizeGuid(item.plugintypeid!),
        name: item.name ?? "",
        friendlyName: item.friendlyname,
        typeName: item.typename,
      }));
  }

  async listSteps(pluginTypeId: string): Promise<PluginStep[]> {
    const normalizedPluginTypeId = this.normalizeGuid(pluginTypeId);
    const filter = encodeURIComponent(`_eventhandler_value eq ${normalizedPluginTypeId}`);
    const url = `/sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,stage,mode,rank,statecode,statuscode,filteringattributes&$filter=${filter}&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode)`;
    const response = await this.client.get<{
      value?: Array<{
        sdkmessageprocessingstepid?: string;
        name?: string;
        stage?: number;
        mode?: number;
        rank?: number;
        statecode?: number;
        statuscode?: number;
        filteringattributes?: string;
        sdkmessageid?: { name?: string };
        sdkmessagefilterid?: { primaryobjecttypecode?: string };
      }>;
    }>(url);

    return (response.value ?? [])
      .filter((item) => item.sdkmessageprocessingstepid && item.name)
      .map((item) => ({
        id: this.normalizeGuid(item.sdkmessageprocessingstepid!),
        name: item.name ?? "",
        mode: item.mode,
        stage: item.stage,
        rank: item.rank,
        status: item.statecode,
        statusReason: item.statuscode,
        messageName: item.sdkmessageid?.name,
        primaryEntity: item.sdkmessagefilterid?.primaryobjecttypecode,
        filteringAttributes: item.filteringattributes,
      }));
  }

  async listImages(stepId: string): Promise<PluginImage[]> {
    const normalizedStepId = this.normalizeGuid(stepId);
    const filter = encodeURIComponent(`_sdkmessageprocessingstepid_value eq ${normalizedStepId}`);
    const url =
      `/sdkmessageprocessingstepimages?$select=sdkmessageprocessingstepimageid,name,imagetype,entityalias,attributes,messagepropertyname&$filter=${filter}`;
    const response = await this.client.get<{
      value?: Array<{
        sdkmessageprocessingstepimageid?: string;
        name?: string;
        imagetype?: number;
        entityalias?: string;
        attributes?: string;
        messagepropertyname?: string;
      }>;
    }>(url);

    return (response.value ?? [])
      .filter((item) => item.sdkmessageprocessingstepimageid && item.name)
      .map((item) => ({
        id: this.normalizeGuid(item.sdkmessageprocessingstepimageid!),
        name: item.name ?? "",
        type: item.imagetype,
        entityAlias: item.entityalias,
        attributes: item.attributes,
        messagePropertyName: item.messagepropertyname,
      }));
  }

  async findAssemblyByName(name: string): Promise<PluginAssembly | undefined> {
    const escapedName = name.replace(/'/g, "''");
    const filter = encodeURIComponent(`name eq '${escapedName}'`);
    const url =
      `/pluginassemblies?$select=pluginassemblyid,name,version,isolationmode,publickeytoken,culture,sourcetype&$filter=${filter}&$top=1`;
    const response = await this.client.get<{
      value?: Array<{
        pluginassemblyid?: string;
        name?: string;
        version?: string;
        isolationmode?: number;
        publickeytoken?: string;
        culture?: string;
        sourcetype?: number;
      }>;
    }>(url);

    const record = response.value?.[0];
    if (!record?.pluginassemblyid || !record.name) {
      return undefined;
    }

    return {
      id: this.normalizeGuid(record.pluginassemblyid),
      name: record.name,
      version: record.version,
      isolationMode: record.isolationmode,
      publicKeyToken: record.publickeytoken,
      culture: record.culture,
      sourceType: record.sourcetype,
    };
  }

  private normalizeGuid(value: string): string {
    return value.replace(/[{}]/g, "");
  }
}
