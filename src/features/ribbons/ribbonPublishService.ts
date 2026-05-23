import JSZip from "jszip";
import type * as vscode from "vscode";
import { DEFAULT_SOLUTION_NAME } from "../../shared/solutions";
import { SolutionImportClient, SolutionImportService } from "../dataverse/solutionImportService";
import { RibbonDocument } from "./models";

export interface RibbonPublishSolution {
  solutionId?: string;
  uniqueName: string;
  friendlyName?: string;
  publisherPrefix: string;
  publisherUniqueName?: string;
  generated?: boolean;
}

export interface RibbonPublishOptions {
  token?: vscode.CancellationToken;
  onStatus?: (message: string) => void;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface RibbonPublishResult {
  importJobId: string;
  asyncOperationId?: string;
  durationMs: number;
  entities: string[];
  includesApplicationRibbon: boolean;
}

export interface GeneratedRibbonSolution {
  solutionId: string;
  uniqueName: string;
  friendlyName?: string;
}

interface SolutionListResponse {
  value?: Array<{
    solutionid?: string;
    uniquename?: string;
    friendlyname?: string;
    publisherid?: {
      publisherid?: string;
      uniquename?: string;
      customizationprefix?: string;
    };
  }>;
}

interface SolutionCreateResponse {
  solutionid?: string;
}

interface PublisherListResponse {
  value?: Array<{
    publisherid?: string;
    uniquename?: string;
    customizationprefix?: string;
  }>;
}

export class RibbonPublishService {
  async listUnmanagedSolutions(client: SolutionImportClient): Promise<RibbonPublishSolution[]> {
    const response = await client.get<SolutionListResponse>(
      "/solutions?$select=solutionid,uniquename,friendlyname&$expand=publisherid($select=uniquename,customizationprefix)&$filter=ismanaged eq false&$orderby=friendlyname asc",
    );

    return (response.value ?? [])
      .map((solution) => ({
        uniqueName: solution.uniquename?.trim() ?? "",
        friendlyName: solution.friendlyname?.trim() || undefined,
        publisherPrefix: solution.publisherid?.customizationprefix?.trim() ?? "",
        publisherUniqueName: solution.publisherid?.uniquename?.trim() || undefined,
      }))
      .filter((solution) => solution.uniqueName && solution.publisherPrefix);
  }

  async createGeneratedSolution(
    client: SolutionImportClient,
    publisherPrefix: string,
    scopeName: string,
  ): Promise<RibbonPublishSolution> {
    const publisher = await this.findPublisherByPrefix(client, publisherPrefix);
    if (!publisher.publisherid || !publisher.uniquename || !publisher.customizationprefix) {
      throw new Error(`No publisher was found for prefix ${publisherPrefix}.`);
    }

    return this.createGeneratedSolutionForPublisher(client, publisher, scopeName);
  }

  async createGeneratedSolutionFromDefaultPublisher(
    client: SolutionImportClient,
    scopeName: string,
  ): Promise<RibbonPublishSolution> {
    const publisher = await this.findDefaultPublisher(client);
    if (!publisher.publisherid || !publisher.uniquename || !publisher.customizationprefix) {
      throw new Error("The Default solution publisher is missing required data.");
    }

    return this.createGeneratedSolutionForPublisher(client, publisher, scopeName);
  }

  async listGeneratedSolutions(client: SolutionImportClient): Promise<GeneratedRibbonSolution[]> {
    const response = await client.get<SolutionListResponse>(
      "/solutions?$select=solutionid,uniquename,friendlyname&$filter=ismanaged eq false and startswith(uniquename,'d365tools_ribbon_')&$orderby=createdon desc",
    );

    return (response.value ?? [])
      .map((solution) => ({
        solutionId: normalizeGuid(solution.solutionid ?? ""),
        uniqueName: solution.uniquename?.trim() ?? "",
        friendlyName: solution.friendlyname?.trim() || undefined,
      }))
      .filter((solution) => solution.solutionId && solution.uniqueName);
  }

  async deleteGeneratedSolution(client: SolutionImportClient, solutionId: string): Promise<void> {
    const id = normalizeGuid(solutionId);
    if (!id) {
      throw new Error("Solution id is required.");
    }
    if (!client.delete) {
      throw new Error("This Dataverse client does not support deleting solutions.");
    }

    await client.delete(`/solutions(${id})`);
  }

  async deleteGeneratedSolutionByUniqueName(
    client: SolutionImportClient,
    uniqueName: string,
  ): Promise<void> {
    const safeUniqueName = uniqueName.trim();
    if (!safeUniqueName.startsWith("d365tools_ribbon_")) {
      throw new Error("Only generated ribbon solutions can be deleted by this command.");
    }

    const response = await client.get<SolutionListResponse>(
      `/solutions?$select=solutionid,uniquename&$filter=uniquename eq '${escapeODataString(safeUniqueName)}'&$top=1`,
    );
    const solutionId = normalizeGuid(response.value?.[0]?.solutionid ?? "");
    if (solutionId) {
      await this.deleteGeneratedSolution(client, solutionId);
    }
  }

  async publishDocuments(
    client: SolutionImportClient,
    documents: RibbonDocument[],
    solution: RibbonPublishSolution,
    options: RibbonPublishOptions = {},
  ): Promise<RibbonPublishResult> {
    const target = buildRibbonPublishTarget(documents);
    if (!target.entities.length && !target.applicationRibbonXml) {
      throw new Error("No entity or application ribbon was selected.");
    }
    if (!solution.publisherPrefix) {
      throw new Error(`Solution ${solution.uniqueName} has no publisher prefix.`);
    }

    await this.preflightEntities(client, target.entities);
    const zipBytes = await buildMinimalRibbonSolutionZip({
      solution,
      entities: target.entities,
      entityRibbonXmlByName: target.entityRibbonXmlByName,
      applicationRibbonXml: target.applicationRibbonXml,
    });

    const importer = new SolutionImportService(client);
    const importResult = await importer.importSolution(zipBytes, {
      overwriteUnmanagedCustomizations: true,
      publishWorkflows: false,
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      token: options.token,
      onStatus: options.onStatus,
    });

    options.onStatus?.("Publishing ribbons");
    await importer.publishRibbons(target.entities, Boolean(target.applicationRibbonXml));

    return {
      importJobId: importResult.importJobId,
      asyncOperationId: importResult.asyncOperationId,
      durationMs: importResult.durationMs,
      entities: target.entities,
      includesApplicationRibbon: Boolean(target.applicationRibbonXml),
    };
  }

  private async preflightEntities(client: SolutionImportClient, entities: string[]): Promise<void> {
    for (const entity of entities) {
      try {
        await client.get(
          `/EntityDefinitions(LogicalName='${escapeODataString(entity)}')?$select=LogicalName`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Entity ${entity} was not found in the target environment: ${message}`);
      }
    }
  }

  private async findPublisherByPrefix(
    client: SolutionImportClient,
    publisherPrefix: string,
  ): Promise<NonNullable<PublisherListResponse["value"]>[number]> {
    const response = await client.get<PublisherListResponse>(
      `/publishers?$select=publisherid,uniquename,customizationprefix&$filter=customizationprefix eq '${escapeODataString(publisherPrefix)}'&$top=1`,
    );
    const publisher = response.value?.[0];
    if (!publisher) {
      throw new Error(`No publisher was found for prefix ${publisherPrefix}.`);
    }

    return publisher;
  }

  private async findDefaultPublisher(
    client: SolutionImportClient,
  ): Promise<NonNullable<PublisherListResponse["value"]>[number]> {
    const response = await client.get<SolutionListResponse>(
      `/solutions?$select=solutionid,uniquename&$expand=publisherid($select=publisherid,uniquename,customizationprefix)&$filter=uniquename eq '${DEFAULT_SOLUTION_NAME}'&$top=1`,
    );
    const publisher = response.value?.[0]?.publisherid;
    if (!publisher) {
      throw new Error("Default solution publisher was not found.");
    }

    return publisher;
  }

  private async createGeneratedSolutionForPublisher(
    client: SolutionImportClient,
    publisher: NonNullable<PublisherListResponse["value"]>[number],
    scopeName: string,
  ): Promise<RibbonPublishSolution> {
    const uniqueName = makeGeneratedSolutionName(scopeName);
    const friendlyName = `D365 Tools Ribbon ${scopeName}`;
    const created = await client.post<SolutionCreateResponse>("/solutions", {
      uniquename: uniqueName,
      friendlyname: friendlyName,
      version: "1.0.0.0",
      "publisherid@odata.bind": `/publishers(${normalizeGuid(publisher.publisherid ?? "")})`,
    });

    return {
      solutionId: normalizeGuid(created.solutionid ?? ""),
      uniqueName,
      friendlyName,
      publisherPrefix: publisher.customizationprefix ?? "",
      publisherUniqueName: publisher.uniquename,
      generated: true,
    };
  }
}

interface RibbonPublishTarget {
  entities: string[];
  entityRibbonXmlByName: Map<string, string>;
  applicationRibbonXml?: string;
}

interface MinimalRibbonZipInput extends RibbonPublishTarget {
  solution: RibbonPublishSolution;
}

export async function buildMinimalRibbonSolutionZip(input: MinimalRibbonZipInput): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", buildContentTypesXml());
  zip.file("solution.xml", buildSolutionXml(input));
  zip.file("customizations.xml", buildCustomizationsXml(input));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export function buildRibbonPublishTarget(documents: RibbonDocument[]): RibbonPublishTarget {
  const entityRibbonXmlByName = new Map<string, string>();
  let applicationRibbonXml: string | undefined;

  for (const document of documents) {
    const ribbonXml = document.sourceText.slice(
      document.ribbonRange.start,
      document.ribbonRange.end,
    );
    if (document.kind === "Application") {
      applicationRibbonXml = ribbonXml;
      continue;
    }

    const entityName = normalizeEntityLogicalName(document.entityLogicalName);
    if (entityName && !entityRibbonXmlByName.has(entityName)) {
      entityRibbonXmlByName.set(entityName, ribbonXml);
    }
  }

  return {
    entities: [...entityRibbonXmlByName.keys()].sort((a, b) => a.localeCompare(b)),
    entityRibbonXmlByName,
    applicationRibbonXml,
  };
}

function buildCustomizationsXml(input: MinimalRibbonZipInput): string {
  const entities = input.entities
    .map((entity) => {
      const ribbonXml = input.entityRibbonXmlByName.get(entity);
      return `    <Entity>
      <Name>${escapeXml(entity)}</Name>
      ${ribbonXml ?? "<RibbonDiffXml />"}
    </Entity>`;
    })
    .join("\n");
  const appRibbon = input.applicationRibbonXml ? `\n  ${input.applicationRibbonXml}` : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<ImportExportXml>
  <Entities>
${entities}
  </Entities>${appRibbon}
</ImportExportXml>`;
}

function buildSolutionXml(input: MinimalRibbonZipInput): string {
  const roots = [
    ...input.entities.map(
      (entity) => `      <RootComponent type="1" schemaName="${escapeXml(entity)}" behavior="0" />`,
    ),
    ...(input.applicationRibbonXml
      ? [`      <RootComponent type="50" schemaName="ApplicationRibbon" behavior="0" />`]
      : []),
  ].join("\n");
  const publisherUniqueName =
    input.solution.publisherUniqueName || `${input.solution.publisherPrefix}publisher`;

  return `<?xml version="1.0" encoding="utf-8"?>
<ImportExportXml>
  <SolutionManifest>
    <UniqueName>${escapeXml(input.solution.uniqueName)}</UniqueName>
    <LocalizedNames>
      <LocalizedName description="${escapeXml(input.solution.friendlyName || input.solution.uniqueName)}" languagecode="1033" />
    </LocalizedNames>
    <Version>1.0.0.0</Version>
    <Managed>0</Managed>
    <Publisher>
      <UniqueName>${escapeXml(publisherUniqueName)}</UniqueName>
      <CustomizationPrefix>${escapeXml(input.solution.publisherPrefix)}</CustomizationPrefix>
    </Publisher>
    <RootComponents>
${roots}
    </RootComponents>
    <MissingDependencies />
  </SolutionManifest>
</ImportExportXml>`;
}

function buildContentTypesXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml" />
</Types>`;
}

function makeGeneratedSolutionName(scopeName: string): string {
  const safeScope = scopeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `d365tools_ribbon_${safeScope || "publish"}_${timestamp}`;
}

function normalizeGuid(value: string): string {
  return value.replace(/[{}]/g, "").trim().toLowerCase();
}

function normalizeEntityLogicalName(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
