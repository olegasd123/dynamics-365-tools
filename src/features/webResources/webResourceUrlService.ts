import * as vscode from "vscode";
import { DataverseClient } from "../dataverse/dataverseClient";
import { EnvironmentConnection } from "../dataverse/environmentConnectionService";

export class WebResourceUrlService {
  async buildClassicWebResourceUrl(
    connection: EnvironmentConnection,
    solutionName: string,
    remotePath: string,
  ): Promise<string | undefined> {
    const client = new DataverseClient(connection);
    let solutionId: string | undefined;
    let webResourceId: string | undefined;

    try {
      [solutionId, webResourceId] = await Promise.all([
        this.resolveSolutionId(client, solutionName),
        this.resolveWebResourceId(client, remotePath),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Could not resolve CRM ids: ${message}`);
      return undefined;
    }

    if (!webResourceId) {
      vscode.window.showErrorMessage(
        `Web resource ${remotePath} not found in ${connection.env.name}; publish it first.`,
      );
      return undefined;
    }

    const base = connection.env.url.replace(/\/+$/, "");
    const params = new URLSearchParams({
      etc: "9333",
      pagetype: "webresourceedit",
      id: `{${webResourceId}}`,
    });

    if (solutionId) {
      params.append("appSolutionId", `{${solutionId}}`);
      params.append("_CreateFromType", "7100");
      params.append("_CreateFromId", `{${solutionId}}`);
    }

    const hash = solutionId ? "#webresource" : "";
    return `${base}/main.aspx?${params.toString()}${hash}`;
  }

  private async resolveSolutionId(
    client: DataverseClient,
    solutionName: string,
  ): Promise<string | undefined> {
    const filter = encodeURIComponent(`uniquename eq '${solutionName.replace(/'/g, "''")}'`);
    const url = `/solutions?$select=solutionid,uniquename&$filter=${filter}&$top=2`;
    const response = await client.get<{ value?: Array<{ solutionid?: string }> }>(url);
    const id = response.value?.[0]?.solutionid;
    return id?.replace(/[{}]/g, "");
  }

  private async resolveWebResourceId(
    client: DataverseClient,
    remotePath: string,
  ): Promise<string | undefined> {
    const escapedName = remotePath.replace(/'/g, "''");
    const filter = encodeURIComponent(`name eq '${escapedName}'`);
    const url = `/webresourceset?$select=webresourceid,name&$filter=${filter}&$top=2`;
    const body = await client.get<{ value?: Array<{ webresourceid?: string }> }>(url);
    if (!body.value?.length) {
      return undefined;
    }
    if (body.value.length > 1) {
      throw new Error(`Multiple web resources found for ${remotePath}; please resolve duplicates.`);
    }

    return body.value[0].webresourceid?.replace(/[{}]/g, "");
  }
}
