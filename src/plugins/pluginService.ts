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

    const response = await this.client.post<{ pluginassemblyid?: string }>(
      "/pluginassemblies",
      payload,
    );
    const id = response.pluginassemblyid || (await this.findAssemblyByName(input.name))?.id;

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

  async listAssemblies(options?: { solutionNames?: string[] }): Promise<PluginAssembly[]> {
    const assemblies = await this.fetchAssemblies();
    const solutionNames = options?.solutionNames?.map((name) => name.trim()).filter(Boolean);
    if (!solutionNames?.length) {
      return assemblies;
    }

    const ids = await this.solutionComponents.listComponentIdsForSolutions(
      SolutionComponentType.PluginAssembly,
      solutionNames,
    );

    if (!ids.size) {
      return [];
    }

    return assemblies.filter((assembly) => ids.has(assembly.id));
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
    const url = `/sdkmessageprocessingstepimages?$select=sdkmessageprocessingstepimageid,name,imagetype,entityalias,attributes,messagepropertyname&$filter=${filter}`;
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
    const url = `/pluginassemblies?$select=pluginassemblyid,name,version,isolationmode,publickeytoken,culture,sourcetype&$filter=${filter}&$top=1`;
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

  async createStep(
    pluginTypeId: string,
    input: {
      name: string;
      messageName: string;
      primaryEntity?: string;
      stage: number;
      mode: number;
      rank?: number;
      filteringAttributes?: string;
      description?: string;
    },
  ): Promise<string> {
    const normalizedPluginTypeId = this.normalizeGuid(pluginTypeId);
    const messageId = await this.resolveSdkMessageId(input.messageName);
    if (!messageId) {
      throw new Error(`SDK message '${input.messageName}' not found.`);
    }

    const filterId = input.primaryEntity
      ? await this.resolveSdkMessageFilterId(messageId, input.primaryEntity)
      : undefined;

    const payload: Record<string, unknown> = {
      name: input.name,
      stage: input.stage,
      mode: input.mode,
      rank: input.rank ?? 1,
      filteringattributes: input.filteringAttributes ?? "",
      description: input.description ?? "",
      supporteddeployment: 0, // server only
      invocationsource: 0, // parent pipeline
      "eventhandler@odata.bind": `/plugintypes(${normalizedPluginTypeId})`,
      "sdkmessageid@odata.bind": `/sdkmessages(${messageId})`,
    };

    if (filterId) {
      payload["sdkmessagefilterid@odata.bind"] = `/sdkmessagefilters(${filterId})`;
    }

    const response = await this.client.post<{ sdkmessageprocessingstepid?: string }>(
      "/sdkmessageprocessingsteps",
      payload,
    );
    const id = response.sdkmessageprocessingstepid;
    if (!id) {
      throw new Error("Step created but no identifier returned.");
    }
    return this.normalizeGuid(id);
  }

  async updateStep(
    stepId: string,
    input: Partial<{
      name: string;
      stage: number;
      mode: number;
      rank: number;
      filteringAttributes: string;
      description: string;
      messageName: string;
      primaryEntity: string;
    }>,
  ): Promise<void> {
    const normalizedStepId = this.normalizeGuid(stepId);
    const payload: Record<string, unknown> = {};

    if (input.name !== undefined) payload.name = input.name;
    if (input.stage !== undefined) payload.stage = input.stage;
    if (input.mode !== undefined) payload.mode = input.mode;
    if (input.rank !== undefined) payload.rank = input.rank;
    if (input.filteringAttributes !== undefined)
      payload.filteringattributes = input.filteringAttributes;
    if (input.description !== undefined) payload.description = input.description;

    if (input.messageName) {
      const messageId = await this.resolveSdkMessageId(input.messageName);
      if (!messageId) {
        throw new Error(`SDK message '${input.messageName}' not found.`);
      }
      payload["sdkmessageid@odata.bind"] = `/sdkmessages(${messageId})`;
    }

    if (input.primaryEntity) {
      const messageId =
        input.messageName && payload["sdkmessageid@odata.bind"]
          ? this.extractIdFromBind(payload["sdkmessageid@odata.bind"] as string)
          : await this.getStepMessageId(normalizedStepId);
      if (!messageId) {
        throw new Error("Cannot update primary entity without message.");
      }
      const filterId = await this.resolveSdkMessageFilterId(messageId, input.primaryEntity);
      payload["sdkmessagefilterid@odata.bind"] = filterId
        ? `/sdkmessagefilters(${filterId})`
        : null;
    }

    await this.client.patch(`/sdkmessageprocessingsteps(${normalizedStepId})`, payload);
  }

  async deleteStep(stepId: string): Promise<void> {
    const normalizedStepId = this.normalizeGuid(stepId);
    await this.client.delete(`/sdkmessageprocessingsteps(${normalizedStepId})`);
  }

  async createImage(
    stepId: string,
    input: {
      name: string;
      type: number;
      entityAlias: string;
      attributes?: string;
      messagePropertyName?: string;
    },
  ): Promise<string> {
    const normalizedStepId = this.normalizeGuid(stepId);
    const payload = {
      name: input.name,
      imagetype: input.type,
      entityalias: input.entityAlias,
      attributes: input.attributes ?? "",
      messagepropertyname: input.messagePropertyName ?? "Target",
      "sdkmessageprocessingstepid@odata.bind": `/sdkmessageprocessingsteps(${normalizedStepId})`,
    };

    const response = await this.client.post<{ sdkmessageprocessingstepimageid?: string }>(
      "/sdkmessageprocessingstepimages",
      payload,
    );
    const id = response.sdkmessageprocessingstepimageid;
    if (!id) {
      throw new Error("Image created but no identifier returned.");
    }
    return this.normalizeGuid(id);
  }

  async updateImage(
    imageId: string,
    input: Partial<{
      name: string;
      type: number;
      entityAlias: string;
      attributes: string;
      messagePropertyName: string;
    }>,
  ): Promise<void> {
    const normalizedImageId = this.normalizeGuid(imageId);
    const payload: Record<string, unknown> = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.type !== undefined) payload.imagetype = input.type;
    if (input.entityAlias !== undefined) payload.entityalias = input.entityAlias;
    if (input.attributes !== undefined) payload.attributes = input.attributes;
    if (input.messagePropertyName !== undefined)
      payload.messagepropertyname = input.messagePropertyName;

    await this.client.patch(`/sdkmessageprocessingstepimages(${normalizedImageId})`, payload);
  }

  async deleteImage(imageId: string): Promise<void> {
    const normalizedImageId = this.normalizeGuid(imageId);
    await this.client.delete(`/sdkmessageprocessingstepimages(${normalizedImageId})`);
  }

  private async resolveSdkMessageId(messageName: string): Promise<string | undefined> {
    const filter = encodeURIComponent(`name eq '${messageName.replace(/'/g, "''")}'`);
    const url = `/sdkmessages?$select=sdkmessageid,name&$filter=${filter}&$top=1`;
    const response = await this.client.get<{ value?: Array<{ sdkmessageid?: string }> }>(url);
    const id = response.value?.[0]?.sdkmessageid;
    return id ? this.normalizeGuid(id) : undefined;
  }

  private async resolveSdkMessageFilterId(
    messageId: string,
    primaryEntity: string,
  ): Promise<string | undefined> {
    const normalizedMessageId = this.normalizeGuid(messageId);
    const filter = encodeURIComponent(
      `_sdkmessageid_value eq ${normalizedMessageId} and primaryobjecttypecode eq '${primaryEntity.replace(/'/g, "''")}'`,
    );
    const url = `/sdkmessagefilters?$select=sdkmessagefilterid,primaryobjecttypecode&$filter=${filter}&$top=1`;
    const response = await this.client.get<{ value?: Array<{ sdkmessagefilterid?: string }> }>(url);
    const id = response.value?.[0]?.sdkmessagefilterid;
    return id ? this.normalizeGuid(id) : undefined;
  }

  private extractIdFromBind(bind: string): string | undefined {
    const match = bind.match(/\(([0-9a-fA-F-]{36})\)/);
    return match?.[1];
  }

  private async fetchAssemblies(): Promise<PluginAssembly[]> {
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

  private async getStepMessageId(stepId: string): Promise<string | undefined> {
    const url = `/sdkmessageprocessingsteps(${stepId})?$select=sdkmessageprocessingstepid&$expand=sdkmessageid($select=sdkmessageid)`;
    const response = await this.client.get<{ sdkmessageid?: { sdkmessageid?: string } }>(url);
    const id = response.sdkmessageid?.sdkmessageid;
    return id ? this.normalizeGuid(id) : undefined;
  }

  private normalizeGuid(value: string): string {
    return value.replace(/[{}]/g, "");
  }
}
