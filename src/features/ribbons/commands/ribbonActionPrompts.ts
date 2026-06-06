import * as vscode from "vscode";
import { CommandContext } from "@app/commandContext";
import { ActionParameter, CommandAction } from "../models";
import { NewCommandActionInput } from "../ribbonEditPatches";
import { showRibbonInputBox, showRibbonQuickPick } from "./ribbonPromptUi";
import { pickJavaScriptFunctionName, pickWebResourceLibrary } from "./ribbonResourcePrompts";

interface CrmParameterPick extends vscode.QuickPickItem {
  value?: string;
  custom?: boolean;
}

interface ActionParameterListPick extends vscode.QuickPickItem {
  action: "add" | "done" | "edit";
  index?: number;
}

interface ActionParameterEditPick extends vscode.QuickPickItem {
  action: "edit" | "delete" | "back";
}

interface UrlWindowModePick extends vscode.QuickPickItem {
  value?: number;
}

const CUSTOM_CRM_PARAMETERS = "Type custom parameters";

const CUSTOM_CRM_PARAMETER_VALUE = "Type custom CRM parameter";

const CRM_PARAMETER_PICKS: CrmParameterPick[] = [
  {
    label: "PrimaryControl",
    description: "Current form context",
    value: "PrimaryControl",
  },
  {
    label: "SelectedControl",
    description: "Current grid context",
    value: "SelectedControl",
  },
  {
    label: "SelectedControlSelectedItemIds",
    description: "Selected grid row ids",
    value: "SelectedControlSelectedItemIds",
  },
  {
    label: "SelectedControlSelectedItemCount",
    description: "Selected grid row count",
    value: "SelectedControlSelectedItemCount",
  },
  {
    label: "SelectedControlSelectedItemReferences",
    description: "Selected grid row references",
    value: "SelectedControlSelectedItemReferences",
  },
  {
    label: "SelectedControlAllItemIds",
    description: "All grid row ids",
    value: "SelectedControlAllItemIds",
  },
  {
    label: "SelectedControlAllItemCount",
    description: "All grid row count",
    value: "SelectedControlAllItemCount",
  },
  {
    label: "SelectedControlAllItemReferences",
    description: "All grid row references",
    value: "SelectedControlAllItemReferences",
  },
  {
    label: "SelectedControlUnselectedItemIds",
    description: "Unselected grid row ids",
    value: "SelectedControlUnselectedItemIds",
  },
  {
    label: "SelectedControlUnselectedItemCount",
    description: "Unselected grid row count",
    value: "SelectedControlUnselectedItemCount",
  },
  {
    label: "SelectedControlUnselectedItemReferences",
    description: "Unselected grid row references",
    value: "SelectedControlUnselectedItemReferences",
  },
  {
    label: "SelectedEntityTypeName",
    description: "Selected row table name",
    value: "SelectedEntityTypeName",
  },
  {
    label: "FirstPrimaryItemId",
    description: "First primary record id",
    value: "FirstPrimaryItemId",
  },
  {
    label: "PrimaryEntityTypeName",
    description: "Primary table name",
    value: "PrimaryEntityTypeName",
  },
  {
    label: "PrimaryItemIds",
    description: "Primary record ids",
    value: "PrimaryItemIds",
  },
  {
    label: "CommandProperties",
    description: "Command metadata",
    value: "CommandProperties",
  },
  {
    label: "OrgName",
    description: "Organization name",
    value: "OrgName",
  },
  {
    label: "OrgLcid",
    description: "Organization language code",
    value: "OrgLcid",
  },
  {
    label: "UserLcid",
    description: "User language code",
    value: "UserLcid",
  },
];

export async function promptJavaScriptAction(
  ctx: CommandContext,
  current?: Extract<CommandAction, { kind: "JavaScriptFunction" }>,
): Promise<NewCommandActionInput | undefined> {
  const library = await pickWebResourceLibrary(ctx, current?.library.uniqueName);
  if (!library) {
    return undefined;
  }

  const functionName = await pickJavaScriptFunctionName(
    ctx.core.files,
    library,
    current?.functionName,
  );
  if (!functionName) {
    return undefined;
  }

  const crmParameters = await promptCrmParameters(current?.parameters);
  if (crmParameters === undefined) {
    return undefined;
  }
  const currentTypedParameters = current?.parameters.filter(
    (parameter) => parameter.kind !== "Crm",
  );
  const typedParameters = await promptTypedActionParameters(currentTypedParameters ?? [], {
    prompt: "Typed parameters",
    placeHolder: "String:beforeSave, Bool:true, Int:1",
    requireNames: false,
  });

  return {
    kind: "JavaScriptFunction" as const,
    library: library.uniqueName,
    functionName: functionName.trim(),
    parameters: [...crmParameters, ...(typedParameters ?? currentTypedParameters ?? [])],
  };
}

async function promptCrmParameters(
  currentParameters: ActionParameter[] = [],
): Promise<ActionParameter[] | undefined> {
  const currentCrmValues = currentParameters
    .filter((parameter) => parameter.kind === "Crm")
    .map((parameter) => parameter.value);
  const knownCrmValues = new Set(CRM_PARAMETER_PICKS.map((pick) => pick.value?.toLowerCase()));
  const customCrmValues = currentCrmValues.filter(
    (value) => !knownCrmValues.has(value.toLowerCase()),
  );
  const picks = await showRibbonQuickPick<CrmParameterPick>(
    [
      {
        label: CUSTOM_CRM_PARAMETERS,
        description: "Add values that are not in the list",
        custom: true,
        picked: customCrmValues.length > 0,
      },
      ...CRM_PARAMETER_PICKS.map((pick) => ({
        ...pick,
        picked: currentCrmValues.some((value) => value.toLowerCase() === pick.value?.toLowerCase()),
      })),
    ],
    {
      canPickMany: true,
      placeHolder: "CRM parameters",
    },
  );
  if (!picks) {
    return undefined;
  }

  const values = picks.map((pick) => pick.value).filter((value): value is string => Boolean(value));
  if (!picks.some((pick) => pick.custom)) {
    return toCrmParameters(values);
  }

  const input = await showRibbonInputBox({
    prompt: "Custom CRM parameters",
    placeHolder: "CustomValue, OtherValue",
    value: customCrmValues.join(", "),
    validateInput: validateCrmParameters,
  });
  if (input === undefined) {
    return undefined;
  }

  return toCrmParameters([...values, ...parseCrmParameterValues(input)]);
}

function parseCrmParameterValues(input: string): string[] {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function toCrmParameters(values: string[]): ActionParameter[] {
  const seen = new Set<string>();
  return values
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((value) => ({ kind: "Crm", value }));
}

function validateCrmParameters(input: string): string | undefined {
  const hasEmptyItem = Boolean(input.trim()) && input.split(",").some((value) => !value.trim());
  return hasEmptyItem ? "Remove empty CRM parameter values." : undefined;
}

export async function promptCommandAction(
  ctx: CommandContext,
  current?: CommandAction,
): Promise<NewCommandActionInput | undefined> {
  const currentKind =
    current?.kind === "JavaScriptFunction"
      ? "JavaScript function"
      : current?.kind === "Url"
        ? "URL"
        : undefined;
  const actionKinds = [
    { label: "JavaScript function", description: "Call a workspace web resource" },
    { label: "URL", description: "Open a URL" },
  ];
  const actionKind = await showRibbonQuickPick(
    currentKind
      ? actionKinds.map((item) =>
          item.label === currentKind ? { ...item, description: "Current action type" } : item,
        )
      : actionKinds,
    { placeHolder: "Command action" },
  );
  if (!actionKind) {
    return undefined;
  }

  return actionKind.label === "URL"
    ? promptUrlAction(current?.kind === "Url" ? current : undefined)
    : promptJavaScriptAction(ctx, current?.kind === "JavaScriptFunction" ? current : undefined);
}

export async function promptOptionalCommandAction(
  ctx: CommandContext,
): Promise<NewCommandActionInput | undefined | null> {
  const actionKind = await showRibbonQuickPick(
    [
      { label: "JavaScript function", description: "Call a workspace web resource" },
      { label: "URL", description: "Open a URL" },
      { label: "No action", description: "Create an empty Actions block" },
    ],
    { placeHolder: "Command action" },
  );
  if (!actionKind) {
    return undefined;
  }

  if (actionKind.label === "No action") {
    return null;
  }

  return actionKind.label === "URL" ? promptUrlAction() : promptJavaScriptAction(ctx);
}

export async function promptUrlAction(
  current?: Extract<CommandAction, { kind: "Url" }>,
): Promise<NewCommandActionInput | undefined> {
  const address = await showRibbonInputBox({
    prompt: "URL",
    placeHolder: "https://contoso.example",
    value: current?.address ?? "",
    validateInput: (value) => (value.trim() ? undefined : "URL is required."),
  });
  if (!address) {
    return undefined;
  }

  const parameters = await promptTypedActionParameters(current?.parameters ?? [], {
    prompt: "URL parameters",
    placeHolder: "Crm:recordId=FirstPrimaryItemId, String:data=source",
    requireNames: true,
  });

  return {
    kind: "Url" as const,
    address: address.trim(),
    passParams: await promptOptionalUrlBoolean("Pass URL context parameters", current?.passParams),
    winMode: await promptUrlWindowMode(current?.winMode),
    winParams: await promptUrlWindowParams(current?.winParams),
    parameters: parameters ?? current?.parameters ?? [],
  };
}

async function promptOptionalUrlBoolean(
  prompt: string,
  current?: boolean,
): Promise<boolean | undefined> {
  const pick = await showRibbonQuickPick(
    [
      { label: "Not set", description: current === undefined ? "Current value" : undefined },
      { label: "true", description: current === true ? "Current value" : undefined },
      { label: "false", description: current === false ? "Current value" : undefined },
    ],
    { placeHolder: prompt },
  );

  if (!pick) {
    return current;
  }

  if (pick.label === "Not set") {
    return undefined;
  }

  return pick.label === "true";
}

async function promptUrlWindowMode(current?: number): Promise<number | undefined> {
  const known = new Set([0, 1]);
  const currentPick: UrlWindowModePick[] =
    current !== undefined && !known.has(current)
      ? [
          {
            label: String(current),
            description: "Current custom mode",
            value: current,
          },
        ]
      : [];
  const pick = await showRibbonQuickPick<UrlWindowModePick>(
    [
      {
        label: "Not set",
        description:
          current === undefined
            ? "Current value. Use default client behavior."
            : "Use default client behavior.",
      },
      {
        label: "0",
        description: current === 0 ? "Current value. Open normally." : "Open normally.",
        value: 0,
      },
      {
        label: "1",
        description:
          current === 1
            ? "Current value. Open in a new popup window."
            : "Open in a new popup window.",
        value: 1,
      },
      ...currentPick,
    ],
    { placeHolder: "Window mode" },
  );

  if (!pick) {
    return current;
  }

  return pick.value;
}

async function promptUrlWindowParams(current?: string): Promise<string | undefined> {
  const value = await showRibbonInputBox({
    prompt: "Window params",
    placeHolder: "For example height=600,width=800,resizable=yes,scrollbars=yes,menubar=no",
    value: current ?? "",
  });

  if (value === undefined) {
    return current;
  }

  return value.trim() || undefined;
}

async function promptTypedActionParameters(
  currentParameters: ActionParameter[],
  options: {
    prompt: string;
    placeHolder: string;
    requireNames: boolean;
  },
): Promise<ActionParameter[] | undefined> {
  const parameters = [...currentParameters];

  while (true) {
    const pick = await showRibbonQuickPick<ActionParameterListPick>(
      actionParameterListPicks(parameters),
      { placeHolder: options.prompt },
    );
    if (!pick) {
      return undefined;
    }

    if (pick.action === "done") {
      return parameters;
    }

    if (pick.action === "add") {
      const parameter = await promptActionParameter(options.requireNames);
      if (parameter) {
        parameters.push(parameter);
      }
      continue;
    }

    const index = pick.index;
    if (index === undefined || !parameters[index]) {
      continue;
    }

    const editPick = await showRibbonQuickPick<ActionParameterEditPick>(
      [
        { label: "Edit", description: formatActionParameter(parameters[index]), action: "edit" },
        {
          label: "Delete",
          description: formatActionParameter(parameters[index]),
          action: "delete",
        },
        { label: "Back", action: "back" },
      ],
      { placeHolder: formatActionParameter(parameters[index]) },
    );
    if (!editPick || editPick.action === "back") {
      continue;
    }

    if (editPick.action === "delete") {
      parameters.splice(index, 1);
      continue;
    }

    const updated = await promptActionParameter(options.requireNames, parameters[index]);
    if (updated) {
      parameters[index] = updated;
    }
  }
}

function actionParameterListPicks(parameters: ActionParameter[]): ActionParameterListPick[] {
  return [
    {
      label: "Done",
      description: `${parameters.length} parameter${parameters.length === 1 ? "" : "s"}`,
      action: "done",
    },
    { label: "Add parameter", description: "Create a parameter", action: "add" },
    ...parameters.map((parameter, index) => ({
      label: `${index + 1}. ${formatActionParameter(parameter)}`,
      description: parameter.kind,
      action: "edit" as const,
      index,
    })),
  ];
}

async function promptActionParameter(
  requireName: boolean,
  current?: ActionParameter,
): Promise<ActionParameter | undefined> {
  const kind = await promptActionParameterKind(current?.kind);
  if (!kind) {
    return undefined;
  }

  const name = requireName ? await promptActionParameterName(current?.name) : undefined;
  if (requireName && name === undefined) {
    return undefined;
  }

  const value = await promptActionParameterValue(kind, current?.value);
  if (value === undefined) {
    return undefined;
  }

  return { kind, name, value };
}

async function promptActionParameterKind(
  current?: ActionParameter["kind"],
): Promise<ActionParameter["kind"] | undefined> {
  const kinds: ActionParameter["kind"][] = ["Crm", "String", "Bool", "Int", "Decimal", "Float"];
  const pick = await showRibbonQuickPick(
    kinds.map((kind) => ({
      label: kind,
      description: kind === current ? "Current kind" : undefined,
    })),
    { placeHolder: "Parameter kind" },
  );

  return pick ? normalizeActionParameterKind(pick.label) : undefined;
}

async function promptActionParameterName(current?: string): Promise<string | undefined> {
  const name = await showRibbonInputBox({
    prompt: "Parameter name",
    placeHolder: "recordId",
    value: current ?? "",
    validateInput: (value) => (value.trim() ? undefined : "Parameter name is required."),
  });

  return name?.trim() || undefined;
}

async function promptActionParameterValue(
  kind: ActionParameter["kind"],
  current?: string,
): Promise<string | undefined> {
  if (kind === "Crm") {
    return promptActionParameterCrmValue(current);
  }

  const value = await showRibbonInputBox({
    prompt: "Parameter value",
    placeHolder: actionParameterValuePlaceholder(kind),
    value: current ?? "",
    validateInput: (input) => validateActionParameterValueInput(kind, input),
  });

  return value?.trim() || undefined;
}

async function promptActionParameterCrmValue(current?: string): Promise<string | undefined> {
  const currentKnown = CRM_PARAMETER_PICKS.some(
    (pick) => pick.value?.toLowerCase() === current?.toLowerCase(),
  );
  const currentPick =
    current && !currentKnown
      ? [
          {
            label: current,
            description: "Current value",
            value: current,
          },
        ]
      : [];
  const pick = await showRibbonQuickPick<CrmParameterPick>(
    [
      ...currentPick,
      ...CRM_PARAMETER_PICKS.map((item) => ({
        ...item,
        description:
          current && item.value?.toLowerCase() === current.toLowerCase()
            ? "Current value"
            : item.description,
      })),
      {
        label: CUSTOM_CRM_PARAMETER_VALUE,
        description: "Type a CRM parameter value",
        custom: true,
      },
    ],
    { placeHolder: "CRM parameter" },
  );
  if (!pick) {
    return undefined;
  }

  if (!pick.custom) {
    return pick.value;
  }

  const value = await showRibbonInputBox({
    prompt: "CRM parameter value",
    placeHolder: "FirstPrimaryItemId",
    value: current ?? "",
    validateInput: (input) => (input.trim() ? undefined : "CRM parameter value is required."),
  });

  return value?.trim() || undefined;
}

function actionParameterValuePlaceholder(kind: ActionParameter["kind"]): string {
  switch (kind) {
    case "Crm":
      return "FirstPrimaryItemId";
    case "Bool":
      return "true";
    case "Int":
      return "1";
    case "Decimal":
    case "Float":
      return "1.0";
    case "String":
      return "source";
  }
}

function formatActionParameter(parameter: ActionParameter): string {
  const value = parameter.name ? `${parameter.name}=${parameter.value}` : parameter.value;
  return `${parameter.kind}:${value}`;
}

function normalizeActionParameterKind(value: string): ActionParameter["kind"] {
  const normalized = value.trim().toLowerCase();
  const kinds: ActionParameter["kind"][] = ["Crm", "Bool", "Int", "Float", "String", "Decimal"];
  const kind = kinds.find((item) => item.toLowerCase() === normalized);
  if (!kind) {
    throw new Error("Parameter kind must be Crm, Bool, Int, Float, String, or Decimal.");
  }

  return kind;
}

function validateActionParameterValueInput(
  kind: ActionParameter["kind"],
  input: string,
): string | undefined {
  const value = input.trim();
  if (!value) {
    return `${kind} parameter value is required.`;
  }

  if (kind === "Bool" && !/^(true|false)$/i.test(value)) {
    return "Bool parameter value must be true or false.";
  }

  if (kind === "Int" && !/^-?\d+$/.test(value)) {
    return "Int parameter value must be a whole number.";
  }

  if ((kind === "Float" || kind === "Decimal") && !/^-?\d+(\.\d+)?$/.test(value)) {
    return `${kind} parameter value must be a number.`;
  }

  return undefined;
}

export function promptRequired(
  prompt: string,
  value: string | undefined,
): Thenable<string | undefined> {
  return showRibbonInputBox({
    prompt,
    value: value ?? "",
    validateInput: (input) => (input.trim() ? undefined : `${prompt} is required.`),
  });
}

export function promptOptional(
  prompt: string,
  value: string | undefined,
): Thenable<string | undefined> {
  return showRibbonInputBox({
    prompt,
    value: value ?? "",
  });
}

export function validateOptionalNumber(value: string): string | undefined {
  return value.trim() === "" || /^\d+$/.test(value.trim()) ? undefined : "Use a number.";
}
