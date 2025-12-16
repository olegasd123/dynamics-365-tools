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

  async listComponentIdsForSolutions(
    componentType: SolutionComponentType,
    solutionNames: string[],
  ): Promise<Set<string>> {
    const normalizedNames = Array.from(
      new Set(
        solutionNames
          .map((name) => name.trim())
          .filter((name) => name.length > 0 && !isDefaultSolution(name)),
      ),
    );

    if (!normalizedNames.length) {
      return new Set();
    }

    const componentIds = new Set<string>();
    for (const solutionName of normalizedNames) {
      const solutionId = await this.getSolutionId(solutionName);
      if (!solutionId) {
        continue;
      }

      const filter = encodeURIComponent(
        `componenttype eq ${componentType} and _solutionid_value eq ${this.normalizeGuid(solutionId)}`,
      );
      const url = `/solutioncomponents?$select=objectid&$filter=${filter}`;
      const response = await this.client.get<{ value?: Array<{ objectid?: string }> }>(url);
      for (const record of response.value ?? []) {
        if (record.objectid) {
          componentIds.add(this.normalizeGuid(record.objectid));
        }
      }
    }

    return componentIds;
  }

  private async getSolutionId(solutionName: string): Promise<string | undefined> {
    const filter = encodeURIComponent(`uniquename eq '${solutionName.replace(/'/g, "''")}'`);
    const url = `/solutions?$select=solutionid,uniquename&$filter=${filter}&$top=1`;
    const response = await this.client.get<{ value?: Array<{ solutionid?: string }> }>(url);
    return response.value?.[0]?.solutionid;
  }

  private normalizeGuid(value: string): string {
    return value.replace(/[{}]/g, "");
  }

  private async isComponentInSolution(
    componentId: string,
    componentType: SolutionComponentType,
    solutionId: string,
  ): Promise<boolean> {
    const normalizedComponentId = this.normalizeGuid(componentId);
    const normalizedSolutionId = this.normalizeGuid(solutionId);
    const filter = encodeURIComponent(
      `componenttype eq ${componentType} and objectid eq ${normalizedComponentId} and _solutionid_value eq ${normalizedSolutionId}`,
    );
    const url = `/solutioncomponents?$select=solutioncomponentid&$filter=${filter}&$top=1`;
    const response = await this.client.get<{ value?: Array<{ solutioncomponentid?: string }> }>(url);
    return Boolean(response.value?.length);
  }
}
