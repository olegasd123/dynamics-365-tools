import JSZip from "jszip";
import type * as vscode from "vscode";
import { isDefaultSolution } from "../dataverse/dataverseClient";
import { SolutionImportClient, SolutionImportService } from "../dataverse/solutionImportService";
import { RibbonDocument } from "./models";

export interface RibbonPublishSolution {
  solutionId?: string;
  uniqueName: string;
  friendlyName?: string;
  publisherPrefix: string;
  publisherUniqueName?: string;
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

interface RetrieveVersionResponse {
  Version?: string;
  version?: string;
}

interface EntityDefinitionResponse {
  LogicalName?: string;
  logicalname?: string;
  MetadataId?: string;
  metadataid?: string;
}

interface SolutionComponentListResponse {
  value?: Array<{
    solutioncomponentid?: string;
  }>;
}

export class RibbonPublishService {
  async listUnmanagedSolutions(client: SolutionImportClient): Promise<RibbonPublishSolution[]> {
    const response = await client.get<SolutionListResponse>(
      "/solutions?$select=solutionid,uniquename,friendlyname&$expand=publisherid($select=uniquename,customizationprefix)&$filter=ismanaged eq false&$orderby=friendlyname asc",
    );

    return (response.value ?? [])
      .map((solution) => ({
        solutionId: normalizeGuid(solution.solutionid ?? "") || undefined,
        uniqueName: solution.uniquename?.trim() ?? "",
        friendlyName: solution.friendlyname?.trim() || undefined,
        publisherPrefix: solution.publisherid?.customizationprefix?.trim() ?? "",
        publisherUniqueName: solution.publisherid?.uniquename?.trim() || undefined,
      }))
      .filter((solution) => solution.uniqueName && solution.publisherPrefix);
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

    const entityMetadataIds = await this.preflightEntities(client, target.entities);
    await this.preflightSolutionEntities(client, solution, entityMetadataIds);
    const packageMetadata = await this.getSolutionPackageMetadata(client);
    const zipBytes = await buildMinimalRibbonSolutionZip({
      solution,
      entities: target.entities,
      entityRibbonXmlByName: target.entityRibbonXmlByName,
      applicationRibbonXml: target.applicationRibbonXml,
      packageMetadata,
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

  private async preflightEntities(
    client: SolutionImportClient,
    entities: string[],
  ): Promise<Map<string, string>> {
    const metadataIds = new Map<string, string>();

    for (const entity of entities) {
      let response: EntityDefinitionResponse;
      try {
        response = await client.get<EntityDefinitionResponse>(
          `/EntityDefinitions(LogicalName='${escapeODataString(entity)}')?$select=LogicalName,MetadataId`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Entity ${entity} was not found in the target environment: ${message}`);
      }

      const metadataId = normalizeGuid(response.MetadataId ?? response.metadataid ?? "");
      if (!metadataId) {
        throw new Error(`Entity ${entity} metadata id was not returned by Dataverse.`);
      }
      metadataIds.set(entity, metadataId);
    }

    return metadataIds;
  }

  private async preflightSolutionEntities(
    client: SolutionImportClient,
    solution: RibbonPublishSolution,
    entityMetadataIds: Map<string, string>,
  ): Promise<void> {
    if (!entityMetadataIds.size || isDefaultSolution(solution.uniqueName)) {
      return;
    }

    const solutionId = await this.resolveSolutionId(client, solution);
    if (!solutionId) {
      throw new Error(`Solution ${solution.uniqueName} was not found.`);
    }

    const missing: string[] = [];
    for (const [entity, metadataId] of entityMetadataIds) {
      if (!(await this.isEntityInSolution(client, metadataId, solutionId))) {
        missing.push(entity);
      }
    }

    if (missing.length) {
      throw new Error(
        `Selected solution ${solution.uniqueName} does not contain ${formatEntityList(missing)}. Select a solution that contains the entity, or add the entity to that solution first.`,
      );
    }
  }

  private async resolveSolutionId(
    client: SolutionImportClient,
    solution: RibbonPublishSolution,
  ): Promise<string | undefined> {
    const existingId = normalizeGuid(solution.solutionId ?? "");
    if (existingId) {
      return existingId;
    }

    const response = await client.get<SolutionListResponse>(
      `/solutions?$select=solutionid,uniquename&$filter=uniquename eq '${escapeODataString(solution.uniqueName)}'&$top=1`,
    );
    return normalizeGuid(response.value?.[0]?.solutionid ?? "") || undefined;
  }

  private async isEntityInSolution(
    client: SolutionImportClient,
    entityMetadataId: string,
    solutionId: string,
  ): Promise<boolean> {
    const filter = encodeURIComponent(
      `componenttype eq ${ENTITY_COMPONENT_TYPE} and objectid eq ${entityMetadataId} and _solutionid_value eq ${solutionId}`,
    );
    const response = await client.get<SolutionComponentListResponse>(
      `/solutioncomponents?$select=solutioncomponentid&$filter=${filter}&$top=1`,
    );
    return Boolean(response.value?.length);
  }

  private async getSolutionPackageMetadata(
    client: SolutionImportClient,
  ): Promise<SolutionPackageMetadata> {
    try {
      const response = await client.get<RetrieveVersionResponse>("RetrieveVersion()");
      const version = normalizePackageVersion(response.Version ?? response.version);
      if (version) {
        return makeSolutionPackageMetadata(version);
      }
    } catch {
      // Use a current Dataverse package marker when the version function is unavailable.
    }

    return makeSolutionPackageMetadata(DEFAULT_DATAVERSE_VERSION);
  }
}

interface RibbonPublishTarget {
  entities: string[];
  entityRibbonXmlByName: Map<string, string>;
  applicationRibbonXml?: string;
}

interface MinimalRibbonZipInput extends RibbonPublishTarget {
  solution: RibbonPublishSolution;
  packageMetadata?: SolutionPackageMetadata;
}

interface SolutionPackageMetadata {
  version: string;
  solutionPackageVersion: string;
  generatedBy: string;
  languageCode: string;
}

const DEFAULT_DATAVERSE_VERSION = "9.2.0.0";
const ENTITY_COMPONENT_TYPE = 1;

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
<ImportExportXml ${buildImportExportXmlAttributes(input.packageMetadata)}>
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
<ImportExportXml ${buildImportExportXmlAttributes(input.packageMetadata)}>
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

function buildImportExportXmlAttributes(metadata = makeSolutionPackageMetadata()): string {
  return [
    `version="${escapeXml(metadata.version)}"`,
    `SolutionPackageVersion="${escapeXml(metadata.solutionPackageVersion)}"`,
    `languagecode="${escapeXml(metadata.languageCode)}"`,
    `generatedBy="${escapeXml(metadata.generatedBy)}"`,
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
  ].join(" ");
}

function buildContentTypesXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml" />
</Types>`;
}

function normalizeGuid(value: string): string {
  return value.replace(/[{}]/g, "").trim().toLowerCase();
}

function formatEntityList(entities: string[]): string {
  if (entities.length === 1) {
    return entities[0];
  }

  return `${entities.slice(0, -1).join(", ")} and ${entities[entities.length - 1]}`;
}

function normalizeEntityLogicalName(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizePackageVersion(value: string | undefined): string | undefined {
  const version = value?.trim().match(/\d+(?:\.\d+){1,3}/)?.[0];
  if (!version) {
    return undefined;
  }

  const parts = version.split(".");
  while (parts.length < 4) {
    parts.push("0");
  }

  return parts.slice(0, 4).join(".");
}

function makeSolutionPackageMetadata(version = DEFAULT_DATAVERSE_VERSION): SolutionPackageMetadata {
  const normalizedVersion = normalizePackageVersion(version) ?? DEFAULT_DATAVERSE_VERSION;
  const [major, minor] = normalizedVersion.split(".");

  return {
    version: normalizedVersion,
    solutionPackageVersion: `${major}.${minor}`,
    languageCode: "1033",
    generatedBy: "CrmLive",
  };
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
