import * as vscode from "vscode";
import { pickDataverseClient } from "@app/commandUtils";
import { CommandContext } from "@app/commandContext";
import type { DataverseClient } from "@features/dataverse/dataverseClient";
import type { RibbonDocument } from "../models";
import { showRibbonInputBox, showRibbonQuickPick } from "./ribbonPromptUi";

interface MetadataName {
  logicalName: string;
  displayName?: string;
}

interface MetadataNamePick extends vscode.QuickPickItem {
  logicalName?: string;
  manual?: boolean;
  empty?: boolean;
  environment?: boolean;
}

interface MetadataListResponse {
  value?: MetadataRecord[];
  "@odata.nextLink"?: string;
}

interface MetadataRecord {
  LogicalName?: string;
  DisplayName?: MetadataDisplayName;
}

interface MetadataDisplayName {
  UserLocalizedLabel?: {
    Label?: string;
  };
  LocalizedLabels?: Array<{ Label?: string }>;
}

const entityCache = new Map<string, Promise<MetadataName[]>>();
const fieldCache = new Map<string, Promise<MetadataName[]>>();

export async function pickRibbonEntityLogicalName(
  ctx: CommandContext,
  options: {
    prompt: string;
    currentValue?: string;
    allowEmpty?: boolean;
    emptyLabel?: string;
  },
): Promise<string | undefined> {
  const current = options.currentValue?.trim();
  const pick = await showRibbonQuickPick<MetadataNamePick>(
    [
      ...(current
        ? [
            {
              label: current,
              description: "Current value",
              logicalName: current,
              picked: true,
            },
          ]
        : []),
      ...(options.allowEmpty
        ? [
            {
              label: options.emptyLabel ?? "No value",
              description: "Leave this field empty",
              empty: true,
            },
          ]
        : []),
      {
        label: "Pick from environment",
        description: "Select an entity logical name",
        environment: true,
      },
      {
        label: "Type logical name manually",
        description: "Use a custom value",
        manual: true,
      },
    ],
    { placeHolder: options.prompt, matchOnDescription: true },
  );
  if (!pick) {
    return undefined;
  }
  if (pick.empty) {
    return "";
  }
  if (pick.logicalName !== undefined) {
    return pick.logicalName;
  }
  if (pick.manual) {
    return promptLogicalNameManually(options.prompt, current, "account", options.allowEmpty);
  }

  return pickEntityFromEnvironment(ctx, options);
}

export async function pickRibbonFieldLogicalName(
  ctx: CommandContext,
  document: RibbonDocument | undefined,
  options: {
    prompt: string;
    currentValue?: string;
    required?: boolean;
  },
): Promise<string | undefined> {
  const current = options.currentValue?.trim();
  const entityLogicalName = document?.entityLogicalName?.trim();
  const pick = await showRibbonQuickPick<MetadataNamePick>(
    [
      ...(current
        ? [
            {
              label: current,
              description: "Current value",
              logicalName: current,
              picked: true,
            },
          ]
        : []),
      ...(entityLogicalName
        ? [
            {
              label: `Pick from ${entityLogicalName}`,
              description: "Select a field logical name",
              environment: true,
            },
          ]
        : [
            {
              label: "Pick from environment",
              description: "Select an entity, then a field",
              environment: true,
            },
          ]),
      {
        label: "Type field name manually",
        description: "Use a custom value",
        manual: true,
      },
    ],
    { placeHolder: options.prompt, matchOnDescription: true },
  );
  if (!pick) {
    return undefined;
  }
  if (pick.logicalName !== undefined) {
    return pick.logicalName;
  }
  if (pick.manual) {
    return promptLogicalNameManually(
      options.prompt,
      current,
      "statuscode",
      options.required ? false : true,
    );
  }

  const entity =
    entityLogicalName ??
    (await pickRibbonEntityLogicalName(ctx, {
      prompt: "Entity for fields",
      currentValue: document?.entityLogicalName,
      allowEmpty: false,
    }));
  if (!entity) {
    return undefined;
  }

  return pickFieldFromEnvironment(ctx, entity, options);
}

async function pickEntityFromEnvironment(
  ctx: CommandContext,
  options: {
    prompt: string;
    currentValue?: string;
    allowEmpty?: boolean;
  },
): Promise<string | undefined> {
  const target = await pickDataverseClient(ctx, {
    placeHolder: "Select environment for entity metadata",
  });
  if (!target) {
    return undefined;
  }

  let names: MetadataName[];
  try {
    names = await cachedEntities(target.env.url, target.client);
  } catch (error) {
    await ctx.core.notifications.warning(
      `Unable to load entities. Enter a logical name manually. ${describeError(error)}`,
    );
    return promptLogicalNameManually(
      options.prompt,
      options.currentValue,
      "account",
      options.allowEmpty,
    );
  }

  return pickMetadataName(names, {
    placeHolder: options.prompt,
    currentValue: options.currentValue,
    manualLabel: "Type logical name manually",
    manualPlaceHolder: "account",
    allowEmpty: options.allowEmpty,
  });
}

async function pickFieldFromEnvironment(
  ctx: CommandContext,
  entityLogicalName: string,
  options: {
    prompt: string;
    currentValue?: string;
    required?: boolean;
  },
): Promise<string | undefined> {
  const target = await pickDataverseClient(ctx, {
    placeHolder: `Select environment for ${entityLogicalName} fields`,
  });
  if (!target) {
    return undefined;
  }

  let names: MetadataName[];
  try {
    names = await cachedFields(target.env.url, target.client, entityLogicalName);
  } catch (error) {
    await ctx.core.notifications.warning(
      `Unable to load fields. Enter a field name manually. ${describeError(error)}`,
    );
    return promptLogicalNameManually(
      options.prompt,
      options.currentValue,
      "statuscode",
      options.required ? false : true,
    );
  }

  return pickMetadataName(names, {
    placeHolder: options.prompt,
    currentValue: options.currentValue,
    manualLabel: "Type field name manually",
    manualPlaceHolder: "statuscode",
    allowEmpty: options.required ? false : true,
  });
}

async function pickMetadataName(
  names: MetadataName[],
  options: {
    placeHolder: string;
    currentValue?: string;
    manualLabel: string;
    manualPlaceHolder: string;
    allowEmpty?: boolean;
  },
): Promise<string | undefined> {
  const current = options.currentValue?.trim();
  const items = metadataPickItems(names, current, options);
  const pick = await showRibbonQuickPick<MetadataNamePick>(items, {
    placeHolder: options.placeHolder,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!pick) {
    return undefined;
  }
  if (pick.empty) {
    return "";
  }
  if (pick.manual) {
    return promptLogicalNameManually(
      options.placeHolder,
      current,
      options.manualPlaceHolder,
      options.allowEmpty,
    );
  }

  return pick.logicalName ?? pick.label;
}

function metadataPickItems(
  names: MetadataName[],
  current: string | undefined,
  options: {
    manualLabel: string;
    allowEmpty?: boolean;
  },
): MetadataNamePick[] {
  const sorted = uniqueMetadataNames(names).sort((a, b) =>
    a.logicalName.localeCompare(b.logicalName, undefined, { sensitivity: "base" }),
  );
  const items: MetadataNamePick[] = sorted.map((name) => ({
    label: name.logicalName,
    description: name.displayName,
    logicalName: name.logicalName,
    picked: name.logicalName === current,
  }));

  if (current && !items.some((item) => item.logicalName === current)) {
    items.unshift({
      label: current,
      description: "Current value",
      logicalName: current,
      picked: true,
    });
  }

  if (options.allowEmpty) {
    items.unshift({
      label: "No value",
      description: "Leave this field empty",
      empty: true,
      picked: !current,
    });
  }

  items.push({
    label: options.manualLabel,
    description: "Use a custom value",
    manual: true,
  });

  return items;
}

async function cachedEntities(environmentUrl: string, client: Pick<DataverseClient, "get">) {
  const key = environmentUrl.toLowerCase();
  let cached = entityCache.get(key);
  if (!cached) {
    cached = listEntityNames(client);
    entityCache.set(key, cached);
  }
  return cached;
}

async function cachedFields(
  environmentUrl: string,
  client: Pick<DataverseClient, "get">,
  entityLogicalName: string,
) {
  const key = `${environmentUrl.toLowerCase()}:${entityLogicalName.toLowerCase()}`;
  let cached = fieldCache.get(key);
  if (!cached) {
    cached = listFieldNames(client, entityLogicalName);
    fieldCache.set(key, cached);
  }
  return cached;
}

async function listEntityNames(client: Pick<DataverseClient, "get">): Promise<MetadataName[]> {
  return listMetadataNames(client, "/EntityDefinitions?$select=LogicalName,DisplayName");
}

async function listFieldNames(
  client: Pick<DataverseClient, "get">,
  entityLogicalName: string,
): Promise<MetadataName[]> {
  const escapedEntity = escapeODataString(entityLogicalName);
  return listMetadataNames(
    client,
    `/EntityDefinitions(LogicalName='${escapedEntity}')/Attributes?$select=LogicalName,DisplayName`,
  );
}

async function listMetadataNames(
  client: Pick<DataverseClient, "get">,
  initialUrl: string,
): Promise<MetadataName[]> {
  const names: MetadataName[] = [];
  let nextUrl: string | undefined = initialUrl;

  while (nextUrl) {
    const response: MetadataListResponse = await client.get<MetadataListResponse>(nextUrl);
    for (const item of response.value ?? []) {
      const logicalName = item.LogicalName?.trim();
      if (!logicalName) {
        continue;
      }

      names.push({
        logicalName,
        displayName: displayNameLabel(item.DisplayName),
      });
    }
    nextUrl = response["@odata.nextLink"];
  }

  return uniqueMetadataNames(names);
}

function uniqueMetadataNames(names: MetadataName[]): MetadataName[] {
  const seen = new Set<string>();
  const result: MetadataName[] = [];
  for (const name of names) {
    const key = name.logicalName.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(name);
  }
  return result;
}

async function promptLogicalNameManually(
  prompt: string,
  currentValue: string | undefined,
  placeHolder: string,
  allowEmpty?: boolean,
): Promise<string | undefined> {
  const value = await showRibbonInputBox({
    prompt,
    placeHolder,
    value: currentValue ?? "",
    validateInput: (input) =>
      allowEmpty || input.trim() ? undefined : "Logical name is required.",
  });
  return value?.trim();
}

function displayNameLabel(displayName: MetadataDisplayName | undefined) {
  return (
    displayName?.UserLocalizedLabel?.Label?.trim() ||
    displayName?.LocalizedLabels?.find((label) => label.Label?.trim())?.Label?.trim() ||
    undefined
  );
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
