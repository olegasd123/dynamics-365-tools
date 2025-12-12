import * as vscode from "vscode";
import { Dynamics365Configuration } from "../types";

export class WebResourceService {
  async buildClassicWebResourceUrl(
    env: Dynamics365Configuration["environments"][number],
    token: string,
    solutionName: string,
    remotePath: string,
  ): Promise<string | undefined> {
    let solutionId: string | undefined;
    let webResourceId: string | undefined;

    try {
      [solutionId, webResourceId] = await Promise.all([
        this.resolveSolutionId(env, token, solutionName),
        this.resolveWebResourceId(env, token, remotePath),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Could not resolve CRM ids: ${message}`);
      return undefined;
    }

    if (!webResourceId) {
      vscode.window.showErrorMessage(
        `Web resource ${remotePath} not found in ${env.name}; publish it first.`,
      );
      return undefined;
    }

    const base = env.url.replace(/\/+$/, "");
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
    env: Dynamics365Configuration["environments"][number],
    token: string,
    solutionName: string,
  ): Promise<string | undefined> {
    const apiRoot = env.url.replace(/\/+$/, "") + "/api/data/v9.2";
    const filter = encodeURIComponent(`uniquename eq '${solutionName.replace(/'/g, "''")}'`);
    const url = `${apiRoot}/solutions?$select=solutionid,uniquename&$filter=${filter}&$top=2`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      value?: Array<{ solutionid?: string }>;
    };
    return body.value?.[0]?.solutionid?.replace(/[{}]/g, "");
  }

  private async resolveWebResourceId(
    env: Dynamics365Configuration["environments"][number],
    token: string,
    remotePath: string,
  ): Promise<string | undefined> {
    const apiRoot = env.url.replace(/\/+$/, "") + "/api/data/v9.2";
    const escapedName = remotePath.replace(/'/g, "''");
    const filter = encodeURIComponent(`name eq '${escapedName}'`);
    const url = `${apiRoot}/webresourceset?$select=webresourceid,name&$filter=${filter}&$top=2`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      value?: Array<{ webresourceid?: string }>;
    };
    if (!body.value?.length) {
      return undefined;
    }
    if (body.value.length > 1) {
      throw new Error(`Multiple web resources found for ${remotePath}; please resolve duplicates.`);
    }

    return body.value[0].webresourceid?.replace(/[{}]/g, "");
  }
}
