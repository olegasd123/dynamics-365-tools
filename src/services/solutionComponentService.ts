import { DataverseClient, isDefaultSolution } from "./dataverseClient";

export enum SolutionComponentType {
  WebResource = 61,
  PluginType = 90,
  PluginAssembly = 91,
  PluginStep = 92,
  PluginImage = 93,
}

export class SolutionComponentService {
  constructor(private readonly client: DataverseClient) {}

  async ensureInSolution(
    componentId: string,
    componentType: SolutionComponentType,
    solutionName: string,
  ): Promise<void> {
    if (isDefaultSolution(solutionName)) {
      return;
    }

    const solutionId = await this.getSolutionId(solutionName);
    if (!solutionId) {
      throw new Error(`Solution ${solutionName} not found.`);
    }

    const exists = await this.isComponentInSolution(componentId, componentType, solutionId);
    if (exists) {
      return;
    }

    await this.client.post("/AddSolutionComponent", {
      ComponentId: componentId,
      ComponentType: componentType,
      SolutionUniqueName: solutionName,
      AddRequiredComponents: false,
    });
  }

  private async getSolutionId(solutionName: string): Promise<string | undefined> {
    const filter = encodeURIComponent(`uniquename eq '${solutionName.replace(/'/g, "''")}'`);
    const url = `/solutions?$select=solutionid,uniquename&$filter=${filter}&$top=1`;
    const response = await this.client.get<{ value?: Array<{ solutionid?: string }> }>(url);
    return response.value?.[0]?.solutionid;
  }

  private async isComponentInSolution(
    componentId: string,
    componentType: SolutionComponentType,
    solutionId: string,
  ): Promise<boolean> {
    const normalizedComponentId = componentId.replace(/[{}]/g, "");
    const normalizedSolutionId = solutionId.replace(/[{}]/g, "");
    const filter = encodeURIComponent(
      `componenttype eq ${componentType} and objectid eq ${normalizedComponentId} and _solutionid_value eq ${normalizedSolutionId}`,
    );
    const url = `/solutioncomponents?$select=solutioncomponentid&$filter=${filter}&$top=1`;
    const response = await this.client.get<{ value?: Array<{ solutioncomponentid?: string }> }>(url);
    return Boolean(response.value?.length);
  }
}
