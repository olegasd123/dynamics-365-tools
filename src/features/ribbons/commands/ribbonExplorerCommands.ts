import * as vscode from "vscode";
import * as path from "node:path";
import { CommandContext } from "../../../app/commandContext";
import { pickEnvironmentAndAuth } from "../../../platform/vscode/commandUtils";
import { BindingEntry } from "../../config/domain/models";
import { DataverseClient } from "../../dataverse/dataverseClient";
import { SolutionImportError } from "../../dataverse/solutionImportService";
import { createRibbonPullPlan } from "../ribbonPullService";
import {
  RibbonDocumentNode,
  RibbonExplorerNode,
  RibbonItemNode,
  RibbonSectionNode,
  RibbonSourceNode,
  RibbonViewNode,
} from "../ribbonExplorer";
import {
  createCommandDefinitionPatches,
  createCommandActionPatch,
  createCommandActionReplacePatch,
  createCommandRuleRefPatch,
  createCustomButtonReplacePatch,
  createCustomButtonPatches,
  createDeleteNodePatch,
  createDisplayRulePatches,
  createEnableRulePatches,
  createHideActionReplacePatch,
  createHideActionPatches,
  createLocLabelTitleReplacePatch,
  createLocLabelTitlePatch,
  createLocLabelPatches,
  createNodeAttributeValuePatch,
  createOobButtonReorderPatches,
  createOobStubReplacementPatches,
  createRuleStepReplacePatch,
  createSwapNodePatches,
  makeCustomButtonIds,
  makeHideActionId,
  nextHideActionId,
  NewCommandActionInput,
  NewCustomButtonInput,
  NewRuleStepInput,
} from "../ribbonEditPatches";
import {
  ActionParameter,
  CommandAction,
  CommandDefinition,
  CustomAction,
  DisplayRule,
  EnableRule,
  HideAction,
  LocLabel,
  LocLabelTitle,
  RibbonDocument,
  RibbonSource,
  RibbonView,
  RuleStep,
  TextRange,
} from "../models";
import {
  findOobRibbonLocation,
  listOobRibbonCommands,
  listOobRibbonLocations,
  OobRibbonCommand,
} from "../oobCatalog";
import type { RibbonPublishSolution } from "../ribbonPublishService";
import {
  createRibbonCascadeDeletePlan,
  formatRibbonCascadeDeleteItem,
  RibbonCascadeDeleteItem,
} from "../ribbonCascadeDelete";

const DEFAULT_JAVASCRIPT_FUNCTION_SUGGESTIONS = ["isNaN"];

interface OobCommandPick extends vscode.QuickPickItem {
  command?: OobRibbonCommand;
  manual?: boolean;
}

interface WebResourceLibraryPick extends vscode.QuickPickItem {
  uniqueName: string;
  localPath?: string;
  manual?: boolean;
}

interface CrmParameterPick extends vscode.QuickPickItem {
  value?: string;
  custom?: boolean;
}

interface RibbonLanguageCodePick extends vscode.QuickPickItem {
  languageCode?: number;
  manual?: boolean;
}

interface RibbonLanguageCode {
  code: number;
  name: string;
  locale: string;
}

interface SolutionOpenPick extends vscode.QuickPickItem {
  sourceKind: "environment" | "disk";
}

interface DataverseSolutionPick extends vscode.QuickPickItem {
  uniqueName: string;
}

interface RibbonPublishSolutionPick extends vscode.QuickPickItem {
  solution: RibbonPublishSolution;
}

interface RibbonSourcePick extends vscode.QuickPickItem {
  source: RibbonSource;
}

interface GeneratedSolutionPick extends vscode.QuickPickItem {
  solutionId: string;
}

const SAVE_EXPORT_BACKUP = "Save Backup";
const CUSTOM_CRM_PARAMETERS = "Type custom parameters";
const DELETE_RELATED_ITEMS = "Delete Related Items";
const DELETE_SELECTED_ONLY = "Delete Selected Only";
const DEFAULT_LANGUAGE_CODE = 1033;
const CUSTOM_LANGUAGE_CODE = "Type language code";
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
    label: "SelectedControlSelectedItemReferences",
    description: "Selected grid row references",
    value: "SelectedControlSelectedItemReferences",
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
];
const RIBBON_LANGUAGE_CODES: RibbonLanguageCode[] = [
  { code: 1025, name: "Arabic", locale: "ar-SA" },
  { code: 1026, name: "Bulgarian", locale: "bg-BG" },
  { code: 1027, name: "Catalan", locale: "ca-ES" },
  { code: 1028, name: "Chinese (Traditional)", locale: "zh-TW" },
  { code: 1029, name: "Czech", locale: "cs-CZ" },
  { code: 1030, name: "Danish", locale: "da-DK" },
  { code: 1031, name: "German", locale: "de-DE" },
  { code: 1032, name: "Greek", locale: "el-GR" },
  { code: 1033, name: "English (United States)", locale: "en-US" },
  { code: 1035, name: "Finnish", locale: "fi-FI" },
  { code: 1036, name: "French", locale: "fr-FR" },
  { code: 1037, name: "Hebrew", locale: "he-IL" },
  { code: 1038, name: "Hungarian", locale: "hu-HU" },
  { code: 1040, name: "Italian", locale: "it-IT" },
  { code: 1041, name: "Japanese", locale: "ja-JP" },
  { code: 1042, name: "Korean", locale: "ko-KR" },
  { code: 1043, name: "Dutch", locale: "nl-NL" },
  { code: 1044, name: "Norwegian (Bokmal)", locale: "nb-NO" },
  { code: 1045, name: "Polish", locale: "pl-PL" },
  { code: 1046, name: "Portuguese (Brazil)", locale: "pt-BR" },
  { code: 1048, name: "Romanian", locale: "ro-RO" },
  { code: 1049, name: "Russian", locale: "ru-RU" },
  { code: 1050, name: "Croatian", locale: "hr-HR" },
  { code: 1051, name: "Slovak", locale: "sk-SK" },
  { code: 1053, name: "Swedish", locale: "sv-SE" },
  { code: 1054, name: "Thai", locale: "th-TH" },
  { code: 1055, name: "Turkish", locale: "tr-TR" },
  { code: 1057, name: "Indonesian", locale: "id-ID" },
  { code: 1058, name: "Ukrainian", locale: "uk-UA" },
  { code: 1060, name: "Slovenian", locale: "sl-SI" },
  { code: 1061, name: "Estonian", locale: "et-EE" },
  { code: 1062, name: "Latvian", locale: "lv-LV" },
  { code: 1063, name: "Lithuanian", locale: "lt-LT" },
  { code: 1066, name: "Vietnamese", locale: "vi-VN" },
  { code: 1069, name: "Basque", locale: "eu-ES" },
  { code: 1081, name: "Hindi", locale: "hi-IN" },
  { code: 1086, name: "Malay", locale: "ms-MY" },
  { code: 1087, name: "Kazakh", locale: "kk-KZ" },
  { code: 1088, name: "Kyrgyz", locale: "ky-KG" },
  { code: 1089, name: "Swahili", locale: "sw-KE" },
  { code: 1091, name: "Uzbek", locale: "uz-Latn-UZ" },
  { code: 1094, name: "Punjabi", locale: "pa-IN" },
  { code: 1095, name: "Bengali (India)", locale: "bn-IN" },
  { code: 1097, name: "Tamil", locale: "ta-IN" },
  { code: 1099, name: "Kannada", locale: "kn-IN" },
  { code: 1100, name: "Malayalam", locale: "ml-IN" },
  { code: 1102, name: "Marathi", locale: "mr-IN" },
  { code: 1106, name: "Welsh", locale: "cy-GB" },
  { code: 1110, name: "Galician", locale: "gl-ES" },
];

function withPaletteFocus<T extends vscode.InputBoxOptions | vscode.QuickPickOptions>(
  options?: T,
): T & { ignoreFocusOut: true } {
  return { ...(options ?? ({} as T)), ignoreFocusOut: true };
}

function showRibbonInputBox(options: vscode.InputBoxOptions): Thenable<string | undefined> {
  return vscode.window.showInputBox(withPaletteFocus(options));
}

function showRibbonQuickPick<T extends vscode.QuickPickItem>(
  items: readonly T[] | Thenable<readonly T[]>,
  options: vscode.QuickPickOptions & { canPickMany: true },
): Thenable<T[] | undefined>;
function showRibbonQuickPick<T extends vscode.QuickPickItem>(
  items: readonly T[] | Thenable<readonly T[]>,
  options?: vscode.QuickPickOptions & { canPickMany?: false },
): Thenable<T | undefined>;
function showRibbonQuickPick(
  items: readonly string[] | Thenable<readonly string[]>,
  options: vscode.QuickPickOptions & { canPickMany: true },
): Thenable<string[] | undefined>;
function showRibbonQuickPick(
  items: readonly string[] | Thenable<readonly string[]>,
  options?: vscode.QuickPickOptions & { canPickMany?: false },
): Thenable<string | undefined>;
function showRibbonQuickPick(
  items:
    | readonly vscode.QuickPickItem[]
    | readonly string[]
    | Thenable<readonly vscode.QuickPickItem[] | readonly string[]>,
  options?: vscode.QuickPickOptions,
): Thenable<vscode.QuickPickItem | vscode.QuickPickItem[] | string | string[] | undefined> {
  return vscode.window.showQuickPick(items as never, withPaletteFocus(options) as never);
}

export function listRibbonLanguageCodePicks(
  options: {
    currentLanguageCode?: number;
    preferredLanguageCode?: number;
    unavailableLanguageCodes?: readonly number[];
  } = {},
): RibbonLanguageCodePick[] {
  const unavailable = new Set(options.unavailableLanguageCodes ?? []);
  if (options.currentLanguageCode !== undefined) {
    unavailable.delete(options.currentLanguageCode);
  }

  const picks = RIBBON_LANGUAGE_CODES.filter((language) => !unavailable.has(language.code)).map(
    (language) => ({
      label: language.name,
      description:
        language.code === options.currentLanguageCode
          ? `${language.code} - Current language`
          : String(language.code),
      detail: language.locale,
      languageCode: language.code,
    }),
  );
  const currentKnown = picks.some((pick) => pick.languageCode === options.currentLanguageCode);
  if (options.currentLanguageCode !== undefined && !currentKnown) {
    picks.unshift({
      label: "Unknown language",
      description: `${options.currentLanguageCode} - Current language`,
      detail: "Custom LCID",
      languageCode: options.currentLanguageCode,
    });
  }

  const firstCode = options.currentLanguageCode ?? options.preferredLanguageCode;
  const firstIndex = picks.findIndex((pick) => pick.languageCode === firstCode);
  if (firstIndex > 0) {
    picks.unshift(...picks.splice(firstIndex, 1));
  }

  return [
    ...picks,
    {
      label: CUSTOM_LANGUAGE_CODE,
      description: "Use another LCID",
      manual: true,
    },
  ];
}

async function promptRibbonLanguageCode(
  options: {
    currentLanguageCode?: number;
    unavailableLanguageCodes?: readonly number[];
  } = {},
): Promise<number | undefined> {
  const picks = listRibbonLanguageCodePicks({
    currentLanguageCode: options.currentLanguageCode,
    preferredLanguageCode: DEFAULT_LANGUAGE_CODE,
    unavailableLanguageCodes: options.unavailableLanguageCodes,
  });
  const pick = await showRibbonQuickPick<RibbonLanguageCodePick>(picks, {
    placeHolder: "Language",
  });
  if (!pick) {
    return undefined;
  }

  if (!pick.manual) {
    return pick.languageCode;
  }

  const firstPick = picks.find((item) => item.languageCode !== undefined);
  const languageCode = await showRibbonInputBox({
    prompt: "Language code",
    value: String(options.currentLanguageCode ?? firstPick?.languageCode ?? DEFAULT_LANGUAGE_CODE),
    validateInput: (value) =>
      validateLanguageCodeInput(value, options.unavailableLanguageCodes ?? []),
  });

  return languageCode === undefined ? undefined : Number(languageCode.trim());
}

function validateLanguageCodeInput(
  value: string,
  unavailableLanguageCodes: readonly number[] = [],
): string | undefined {
  const code = value.trim();
  if (!/^\d+$/.test(code)) {
    return "Language code must be a number.";
  }

  return unavailableLanguageCodes.includes(Number(code))
    ? "This LocLabel already has this language."
    : undefined;
}

export function refreshRibbonExplorer(ctx: CommandContext): void {
  ctx.ribbonExplorer.refresh();
}

export async function openRibbonsFromSolution(ctx: CommandContext): Promise<void> {
  const pick = await showRibbonQuickPick<SolutionOpenPick>(
    [
      {
        label: "Download from environment",
        description: "Export an unmanaged solution zip",
        sourceKind: "environment",
      },
      {
        label: "Open zip from disk",
        description: "Use a local solution zip file",
        sourceKind: "disk",
      },
    ],
    { placeHolder: "Open ribbons from solution" },
  );
  if (!pick) {
    return;
  }

  if (pick.sourceKind === "disk") {
    await openRibbonsFromDisk(ctx);
    return;
  }

  await openRibbonsFromEnvironment(ctx);
}

export async function saveRibbonSolutionZip(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const source = await resolveSource(ctx, node);
  if (!source || source.kind !== "zip") {
    vscode.window.showWarningMessage("Select an imported solution zip source first.");
    return;
  }

  if (ctx.ribbonEditorState.isSourceDirty(source.id)) {
    await ctx.ribbonEditorState.saveSource(source.id);
  }

  const defaultUri = source.zip?.originalZipUri
    ? vscode.Uri.file(source.zip.originalZipUri)
    : vscode.Uri.file(path.join(ctx.extensionContext.globalStorageUri.fsPath, source.name));
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { "Solution zip": ["zip"] },
    saveLabel: "Save Solution Zip",
  });
  if (!target) {
    return;
  }

  const savedPath = await ctx.solutionZipService.saveSourceToZip(source, target.fsPath);
  ctx.ribbonExplorer.refresh();
  void vscode.window.showInformationMessage(`Saved solution zip to ${savedPath}.`);
}

export async function saveRibbonSource(
  ctx: CommandContext,
  node?:
    | RibbonSourceNode
    | RibbonDocumentNode
    | RibbonViewNode
    | RibbonSectionNode
    | RibbonItemNode,
): Promise<void> {
  const sourceId = resolveSourceId(node);
  const result = sourceId
    ? await ctx.ribbonEditorState.saveSource(sourceId)
    : await ctx.ribbonEditorState.saveAllSources();
  ctx.ribbonExplorer.refresh();
  const count = result.changedFileUris.length;
  void vscode.window.showInformationMessage(
    count ? `Saved ${count} ribbon file${count === 1 ? "" : "s"}.` : "No ribbon changes to save.",
  );
}

export function undoRibbonEdit(ctx: CommandContext): void {
  if (!ctx.ribbonEditorState.undo()) {
    vscode.window.showWarningMessage("No ribbon edit to undo.");
    return;
  }

  ctx.ribbonExplorer.refresh();
}

export function redoRibbonEdit(ctx: CommandContext): void {
  if (!ctx.ribbonEditorState.redo()) {
    vscode.window.showWarningMessage("No ribbon edit to redo.");
    return;
  }

  ctx.ribbonExplorer.refresh();
}

export async function publishRibbonToEnvironment(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const sourceId = resolveSourceId(node);
  let documents = await resolvePublishDocuments(ctx, node);
  if (!documents.length) {
    vscode.window.showWarningMessage("Select a ribbon source or ribbon document first.");
    return;
  }

  if (sourceId && ctx.ribbonEditorState.isSourceDirty(sourceId)) {
    const choice = await vscode.window.showWarningMessage(
      "Save ribbon changes before publishing?",
      { modal: true },
      "Save and Publish",
    );
    if (choice !== "Save and Publish") {
      return;
    }
    await ctx.ribbonEditorState.saveSource(sourceId);
    ctx.ribbonExplorer.refresh();
    documents = await resolveSavedPublishDocuments(ctx, node, documents);
    if (!documents.length) {
      vscode.window.showWarningMessage("No saved ribbon documents were found to publish.");
      return;
    }
  }

  const config = await ctx.configuration.loadConfiguration();
  const target = await pickEnvironmentAndAuth(
    ctx.configuration,
    ctx.ui,
    ctx.secrets,
    ctx.auth,
    ctx.lastSelection,
    config,
    undefined,
    { placeHolder: "Select environment for ribbon publish" },
  );
  if (!target) {
    return;
  }

  const connection = await ctx.connections.createConnection(target.env, target.auth);
  if (!connection) {
    return;
  }

  const client = new DataverseClient(connection);
  const solutions = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading unmanaged solutions",
      cancellable: false,
    },
    () => ctx.ribbonPublishService.listUnmanagedSolutions(client),
  );
  if (!solutions.length) {
    vscode.window.showWarningMessage("No unmanaged solutions were found in this environment.");
    return;
  }

  const solution = await pickRibbonPublishSolution(solutions);
  if (!solution) {
    return;
  }

  let result:
    | Awaited<ReturnType<CommandContext["ribbonPublishService"]["publishDocuments"]>>
    | undefined;
  let publishError: unknown;

  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Publishing ribbons to ${target.env.name}`,
        cancellable: true,
      },
      (progress, token) =>
        ctx.ribbonPublishService.publishDocuments(client, documents, solution, {
          token,
          onStatus: (message) => progress.report({ message }),
        }),
    );
  } catch (error) {
    publishError = error;
  }

  if (publishError) {
    const error = publishError;
    const message = describeRibbonPublishError(error);
    if (error instanceof SolutionImportError && error.log) {
      const action = await vscode.window.showErrorMessage(
        `Ribbon publish failed: ${message}`,
        "Copy Error XML",
      );
      if (action === "Copy Error XML") {
        await vscode.env.clipboard.writeText(error.log);
      }
      return;
    }

    void vscode.window.showErrorMessage(`Ribbon publish failed: ${message}`);
    return;
  }

  if (!result) {
    return;
  }

  const summary = [
    `${result.entities.length} entit${result.entities.length === 1 ? "y" : "ies"}`,
    result.includesApplicationRibbon ? "application ribbon" : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  void vscode.window.showInformationMessage(
    `Published ribbons to ${target.env.name} solution ${solution.uniqueName} (${summary}).`,
  );
}

export async function pullRibbonsFromEnvironment(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const source = await resolvePullSource(ctx, node);
  if (!source) {
    return;
  }

  if (ctx.ribbonEditorState.isSourceDirty(source.id)) {
    vscode.window.showWarningMessage(
      "Save or undo pending ribbon edits before pulling from the environment.",
    );
    return;
  }

  const targetDocuments = await resolvePullDocuments(ctx, source, node);
  if (!targetDocuments.length) {
    vscode.window.showWarningMessage("No local ribbon documents were found to update.");
    return;
  }

  const config = await ctx.configuration.loadConfiguration();
  const target = await pickEnvironmentAndAuth(
    ctx.configuration,
    ctx.ui,
    ctx.secrets,
    ctx.auth,
    ctx.lastSelection,
    config,
    undefined,
    { placeHolder: "Select environment to pull ribbons from" },
  );
  if (!target) {
    return;
  }

  const connection = await ctx.connections.createConnection(target.env, target.auth);
  if (!connection) {
    return;
  }

  const client = new DataverseClient(connection);
  const solutions = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading unmanaged solutions",
      cancellable: false,
    },
    () => ctx.solutionZipService.listUnmanagedSolutions(client),
  );
  const solutionPick = await pickDataverseSolution(solutions, "Select solution to pull ribbons");
  if (!solutionPick) {
    return;
  }

  const buffer = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Exporting ${solutionPick.uniqueName}`,
      cancellable: false,
    },
    () => ctx.solutionZipService.downloadSolutionZip(client, solutionPick.uniqueName),
  );
  await offerExportedSolutionBackup(ctx, buffer, solutionPick.uniqueName);
  const incomingSource = await ctx.solutionZipService.openZipBuffer(buffer, {
    storageRoot: ctx.extensionContext.globalStorageUri.fsPath,
    sourceName: `${solutionPick.uniqueName}-pull.zip`,
  });
  const incomingDocuments = await ctx.ribbonRepository.loadSource(incomingSource);
  const plan = createRibbonPullPlan(targetDocuments, incomingDocuments);

  if (!plan.matchedDocuments.length) {
    const missing = plan.missingDocuments.length;
    const unchanged = plan.unchangedDocuments.length;
    vscode.window.showInformationMessage(
      missing
        ? `No matching ribbon changes were found (${missing} missing, ${unchanged} unchanged).`
        : "Local ribbons already match the environment.",
    );
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Replace ${plan.matchedDocuments.length} local ribbon block${plan.matchedDocuments.length === 1 ? "" : "s"} from ${solutionPick.uniqueName}?`,
    { modal: true },
    "Pull",
  );
  if (choice !== "Pull") {
    return;
  }

  const result = await ctx.ribbonRepository.savePatchSequence(plan.patchesByFileUri);
  ctx.ribbonExplorer.refresh();

  void vscode.window.showInformationMessage(
    `Pulled ${plan.matchedDocuments.length} ribbon block${plan.matchedDocuments.length === 1 ? "" : "s"} into ${result.changedFileUris.length} file${result.changedFileUris.length === 1 ? "" : "s"}.`,
  );
}

export async function cleanupGeneratedRibbonSolutions(ctx: CommandContext): Promise<void> {
  const config = await ctx.configuration.loadConfiguration();
  const target = await pickEnvironmentAndAuth(
    ctx.configuration,
    ctx.ui,
    ctx.secrets,
    ctx.auth,
    ctx.lastSelection,
    config,
    undefined,
    { placeHolder: "Select environment for generated solution cleanup" },
  );
  if (!target) {
    return;
  }

  const connection = await ctx.connections.createConnection(target.env, target.auth);
  if (!connection) {
    return;
  }

  const client = new DataverseClient(connection);
  const generated = await ctx.ribbonPublishService.listGeneratedSolutions(client);
  if (!generated.length) {
    void vscode.window.showInformationMessage("No generated ribbon solutions were found.");
    return;
  }

  const picks = await showRibbonQuickPick<GeneratedSolutionPick>(
    generated.map((solution) => ({
      label: solution.uniqueName,
      description: solution.friendlyName,
      solutionId: solution.solutionId,
    })),
    {
      canPickMany: true,
      placeHolder: "Select generated ribbon solutions to delete",
    },
  );
  if (!picks?.length) {
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Delete ${picks.length} generated ribbon solution${picks.length === 1 ? "" : "s"}?`,
    { modal: true },
    "Delete",
  );
  if (choice !== "Delete") {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Deleting generated ribbon solutions",
      cancellable: false,
    },
    async () => {
      for (const pick of picks) {
        await ctx.ribbonPublishService.deleteGeneratedSolution(client, pick.solutionId);
      }
    },
  );
  void vscode.window.showInformationMessage(
    `Deleted ${picks.length} generated ribbon solution${picks.length === 1 ? "" : "s"}.`,
  );
}

export async function openRibbonFile(
  node?: RibbonDocumentNode | RibbonSourceNode | RibbonItemNode,
): Promise<void> {
  if (node instanceof RibbonSourceNode && node.source.kind === "flat") {
    const fileUri = node.source.files[0]?.fileUri;
    if (fileUri) {
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(fileUri));
    }
    return;
  }

  if (node instanceof RibbonItemNode && node.editTarget) {
    await openDocumentAtRange(node.editTarget.document, node.editTarget.range.start);
    return;
  }

  if (!(node instanceof RibbonDocumentNode)) {
    vscode.window.showWarningMessage("Select a ribbon document first.");
    return;
  }

  await openDocumentAtRange(node.document, node.document.ribbonRange.start);
}

async function openDocumentAtRange(document: RibbonDocument, offset: number): Promise<void> {
  const textDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(document.fileUri));
  const editor = await vscode.window.showTextDocument(textDocument);
  const position = textDocument.positionAt(offset);
  const range = new vscode.Range(position, position);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function openRibbonsFromDisk(ctx: CommandContext): Promise<void> {
  const picks = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { "Solution zip": ["zip"] },
    openLabel: "Open Solution Zip",
  });
  const zipUri = picks?.[0];
  if (!zipUri) {
    return;
  }

  const source = await ctx.solutionZipService.openZipFile(
    zipUri.fsPath,
    ctx.extensionContext.globalStorageUri.fsPath,
  );
  addImportedRibbonSource(ctx, source);
}

async function resolvePublishDocuments(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
): Promise<RibbonDocument[]> {
  if (node instanceof RibbonDocumentNode) {
    return [node.document];
  }

  if (node instanceof RibbonViewNode || node instanceof RibbonSectionNode) {
    return [node.document];
  }

  if (node instanceof RibbonItemNode && node.editTarget) {
    return [node.editTarget.document];
  }

  const source = await resolveSource(ctx, node);
  if (!source) {
    return [];
  }

  return ctx.ribbonEditorState.loadSource(source);
}

async function resolveSavedPublishDocuments(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
  previousDocuments: RibbonDocument[],
): Promise<RibbonDocument[]> {
  const source = await resolveSource(ctx, node);
  if (!source) {
    return previousDocuments;
  }

  const currentDocuments = await ctx.ribbonEditorState.loadSource(source);
  if (node instanceof RibbonSourceNode) {
    return currentDocuments;
  }

  const matched = previousDocuments
    .map((document) => findMatchingDocument(currentDocuments, document))
    .filter((document): document is RibbonDocument => Boolean(document));

  return matched.length ? matched : previousDocuments;
}

function findMatchingDocument(
  documents: RibbonDocument[],
  previous: RibbonDocument,
): RibbonDocument | undefined {
  return (
    documents.find((document) => document.id === previous.id) ??
    documents.find(
      (document) =>
        document.fileUri === previous.fileUri &&
        document.kind === previous.kind &&
        document.entityLogicalName === previous.entityLogicalName,
    )
  );
}

function describeRibbonPublishError(error: unknown): string {
  if (error instanceof SolutionImportError && error.errors.length) {
    return error.errors.join("; ");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function openRibbonsFromEnvironment(ctx: CommandContext): Promise<void> {
  const config = await ctx.configuration.loadConfiguration();
  const target = await pickEnvironmentAndAuth(
    ctx.configuration,
    ctx.ui,
    ctx.secrets,
    ctx.auth,
    ctx.lastSelection,
    config,
    undefined,
    { placeHolder: "Select environment for solution export" },
  );
  if (!target) {
    return;
  }

  const connection = await ctx.connections.createConnection(target.env, target.auth);
  if (!connection) {
    return;
  }

  const client = new DataverseClient(connection);
  const solutions = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading unmanaged solutions",
      cancellable: false,
    },
    () => ctx.solutionZipService.listUnmanagedSolutions(client),
  );
  const solutionPick = await pickDataverseSolution(solutions, "Select unmanaged solution");
  if (!solutionPick) {
    return;
  }

  const buffer = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Exporting ${solutionPick.uniqueName}`,
      cancellable: false,
    },
    () => ctx.solutionZipService.downloadSolutionZip(client, solutionPick.uniqueName),
  );
  await offerExportedSolutionBackup(ctx, buffer, solutionPick.uniqueName);
  const source = await ctx.solutionZipService.openZipBuffer(buffer, {
    storageRoot: ctx.extensionContext.globalStorageUri.fsPath,
    sourceName: `${solutionPick.uniqueName}.zip`,
  });
  addImportedRibbonSource(ctx, source);
}

async function resolvePullSource(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
): Promise<RibbonSource | undefined> {
  const selected = await resolveSource(ctx, node);
  if (selected) {
    return selected;
  }

  const sources = await ctx.ribbonSourceLocator.locate(ctx.configuration.workspaceRoot);
  if (!sources.length) {
    vscode.window.showWarningMessage("No local ribbon source was found.");
    return undefined;
  }

  if (sources.length === 1) {
    return sources[0];
  }

  const pick = await showRibbonQuickPick<RibbonSourcePick>(
    sources.map((source) => ({
      label: source.name,
      description: source.kind,
      detail: source.rootUri,
      source,
    })),
    { placeHolder: "Select local ribbon source to update" },
  );
  return pick?.source;
}

async function resolvePullDocuments(
  ctx: CommandContext,
  source: RibbonSource,
  node: RibbonExplorerNode | undefined,
): Promise<RibbonDocument[]> {
  if (node instanceof RibbonDocumentNode) {
    return [node.document];
  }

  if (node instanceof RibbonViewNode || node instanceof RibbonSectionNode) {
    return [node.document];
  }

  if (node instanceof RibbonItemNode && node.editTarget) {
    return [node.editTarget.document];
  }

  return ctx.ribbonEditorState.loadSource(source);
}

function pickDataverseSolution(
  solutions: Awaited<ReturnType<CommandContext["solutionZipService"]["listUnmanagedSolutions"]>>,
  placeHolder: string,
): Thenable<DataverseSolutionPick | undefined> {
  return showRibbonQuickPick<DataverseSolutionPick>(
    solutions.map((solution) => ({
      label: solution.uniqueName,
      description: solution.version,
      detail: solution.friendlyName,
      uniqueName: solution.uniqueName,
    })),
    { placeHolder },
  );
}

function pickRibbonPublishSolution(
  solutions: RibbonPublishSolution[],
): Thenable<RibbonPublishSolution | undefined> {
  return showRibbonQuickPick<RibbonPublishSolutionPick>(
    solutions.map((solution) => ({
      label: solution.uniqueName,
      description: solution.publisherPrefix,
      detail: solution.friendlyName,
      solution,
    })),
    { placeHolder: "Select unmanaged solution to update" },
  ).then((pick) => pick?.solution);
}

function addImportedRibbonSource(ctx: CommandContext, source: RibbonSource): void {
  ctx.ribbonSourceLocator.addImportedSource(source);
  ctx.ribbonExplorer.refresh();
  void vscode.window.showInformationMessage(
    `Opened ${source.name} with ${source.files.length} ribbon file${source.files.length === 1 ? "" : "s"}.`,
  );
}

async function offerExportedSolutionBackup(
  ctx: CommandContext,
  buffer: Buffer,
  solutionUniqueName: string,
): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `Save a backup copy of exported solution ${solutionUniqueName}?`,
    { modal: true },
    SAVE_EXPORT_BACKUP,
    "Skip",
  );
  if (choice !== SAVE_EXPORT_BACKUP) {
    return;
  }

  const target = await vscode.window.showSaveDialog({
    defaultUri: defaultSolutionBackupUri(ctx, solutionUniqueName),
    filters: { "Solution zip": ["zip"] },
    saveLabel: "Save Backup",
  });
  if (!target) {
    return;
  }

  const savedPath = await ctx.solutionZipService.saveBufferToZip(buffer, target.fsPath);
  void vscode.window.showInformationMessage(`Saved solution backup to ${savedPath}.`);
}

function defaultSolutionBackupUri(ctx: CommandContext, solutionUniqueName: string): vscode.Uri {
  const root = ctx.configuration.workspaceRoot ?? ctx.extensionContext.globalStorageUri.fsPath;
  return vscode.Uri.file(path.join(root, solutionBackupFileName(solutionUniqueName)));
}

function solutionBackupFileName(solutionUniqueName: string, now = new Date()): string {
  const timestamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[:.]/g, "-");
  const safeName = solutionUniqueName.trim().replace(/[<>:"/\\|?*]/g, "_") || "solution";
  return `${safeName}-backup-${timestamp}.zip`;
}

export async function deleteRibbonNode(ctx: CommandContext, node?: RibbonItemNode): Promise<void> {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    vscode.window.showWarningMessage("Select a ribbon item that can be deleted.");
    return;
  }

  const { document, range } = node.editTarget;
  const plan = createRibbonCascadeDeletePlan(document, node.contextValue, range);
  if (!plan?.related.length) {
    ctx.ribbonEditorState.queuePatches(document, [
      createDeleteNodePatch(document.sourceText, range),
    ]);
    ctx.ribbonExplorer.refresh();
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Delete ${plan.related.length} related ribbon item${plan.related.length === 1 ? "" : "s"}?`,
    {
      modal: true,
      detail: relatedDeleteMessage(plan.related),
    },
    DELETE_RELATED_ITEMS,
    DELETE_SELECTED_ONLY,
  );
  if (!choice) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(
    document,
    choice === DELETE_RELATED_ITEMS
      ? plan.patches
      : [createDeleteNodePatch(document.sourceText, range)],
  );
  ctx.ribbonExplorer.refresh();
}

function relatedDeleteMessage(related: RibbonCascadeDeleteItem[]): string {
  return [
    "These items have only one reference, and it is linked to the item you are deleting:",
    "",
    ...related.map((item) => {
      const reason = item.reason ? ` ${item.reason}` : "";
      return `- ${formatRibbonCascadeDeleteItem(item)}.${reason}`;
    }),
    "",
    "Use Undo Ribbon Edit to restore them.",
  ].join("\n");
}

export async function editRibbonNode(ctx: CommandContext, node?: RibbonItemNode): Promise<void> {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    vscode.window.showWarningMessage("Select a ribbon item that can be edited.");
    return;
  }

  const target = resolveEditableTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("This ribbon item cannot be edited yet.");
    return;
  }

  switch (target.kind) {
    case "CustomAction":
      await editCustomAction(ctx, target.document, target.action);
      return;
    case "HideAction":
      await editHideAction(ctx, target.document, target.action);
      return;
    case "CommandDefinition":
      await editNodeId(
        ctx,
        target.document,
        target.command.range,
        "CommandDefinition id",
        target.command.id,
      );
      return;
    case "EnableRule":
      await editNodeId(ctx, target.document, target.rule.range, "Enable rule id", target.rule.id);
      return;
    case "DisplayRule":
      await editNodeId(ctx, target.document, target.rule.range, "Display rule id", target.rule.id);
      return;
    case "LocLabel":
      await editNodeId(ctx, target.document, target.label.range, "Loc label id", target.label.id);
      return;
    case "CommandAction":
      await editCommandAction(ctx, target.document, target.action);
      return;
    case "RuleStep":
      await editRuleStep(ctx, target.document, target.ruleKind, target.step);
      return;
    case "LocLabelTitle":
      await editLocLabelTitle(ctx, target.document, target.title);
      return;
  }
}

export async function addCustomRibbonButton(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const label = await showRibbonInputBox({
    prompt: "Button label",
    placeHolder: "Validate and save",
    validateInput: (value) => (value.trim() ? undefined : "Button label is required."),
  });
  if (!label) {
    return;
  }

  const location = await pickLocation(target.document, target.view);
  if (!location) {
    return;
  }

  const actionKind = await showRibbonQuickPick(
    [
      { label: "JavaScript function", description: "Call a workspace web resource" },
      { label: "URL", description: "Open a URL" },
    ],
    { placeHolder: "Button action" },
  );
  if (!actionKind) {
    return;
  }

  const ids = makeCustomButtonIds(target.document, target.view.scope, label);
  const labelLocId = ids.labelLocId ?? `${ids.buttonId}.Label`;
  const action =
    actionKind.label === "URL" ? await promptUrlAction() : await promptJavaScriptAction(ctx);
  if (!action) {
    return;
  }

  const image16x16 = await showRibbonInputBox({
    prompt: "Small icon web resource",
    placeHolder: "new_/icons/save16.png",
  });
  const image32x32 = await showRibbonInputBox({
    prompt: "Large icon web resource",
    placeHolder: "new_/icons/save32.png",
  });

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createCustomButtonPatches(target.document, {
      ...ids,
      location,
      action,
      sequence: nextCustomActionSequence(target.view),
      labelLocId,
      image16x16: image16x16?.trim() || undefined,
      image32x32: image32x32?.trim() || undefined,
      templateAlias: "o1",
      locLabel: {
        id: labelLocId,
        languageCode: 1033,
        description: label.trim(),
      },
    }),
  );
  ctx.ribbonExplorer.refresh();
}

export async function hideOobRibbonButton(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const command = await pickOobCommand(target.document, target.view);
  if (!command) {
    return;
  }

  const location = await pickHideLocation(target.document, target.view, command);
  if (!location) {
    return;
  }

  const baseId = makeHideActionId(target.document, target.view.scope, getOobControlId(command));
  const hideActionId = nextHideActionId(target.document, { hideActionId: baseId });
  ctx.ribbonEditorState.queuePatches(
    target.document,
    createHideActionPatches(target.document, { hideActionId, location }),
  );
  ctx.ribbonExplorer.refresh();
}

export async function hideAndStubOobRibbonButtons(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const location = await pickLocation(target.document, target.view);
  if (!location) {
    return;
  }

  const commands = await pickOobCommandsForLocation(target.document, target.view, location);
  if (!commands?.length) {
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Hide ${commands.length} OOB button${commands.length === 1 ? "" : "s"} and create replacement stubs?`,
    { modal: true },
    "Create Stubs",
  );
  if (choice !== "Create Stubs") {
    return;
  }

  const usedIds = collectRibbonIds(target.document);
  const baseSequence = nextCustomActionSequence(target.view);
  const inputs = commands.map((command, index) => {
    const ids = makeCustomButtonIds(
      target.document,
      target.view.scope,
      `${command.label} ${command.id}`,
    );
    const customActionId = nextBatchId(usedIds, ids.customActionId);
    const buttonId = nextBatchId(usedIds, ids.buttonId);
    const commandId = nextBatchId(usedIds, ids.commandId);
    const labelLocId = nextBatchId(usedIds, ids.labelLocId ?? `${buttonId}.Label`);
    const hideActionId = nextBatchId(
      usedIds,
      nextHideActionId(target.document, {
        hideActionId: makeHideActionId(
          target.document,
          target.view.scope,
          getOobControlId(command),
        ),
      }),
    );

    return {
      hideActionId,
      hideLocation: getOobControlId(command),
      customActionId,
      location,
      sequence: baseSequence + index * 10,
      buttonId,
      commandId,
      labelLocId,
      locLabel: {
        id: labelLocId,
        languageCode: 1033,
        description: command.label,
      },
    };
  });

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createOobStubReplacementPatches(target.document, inputs),
  );
  ctx.ribbonExplorer.refresh();
}

export async function reorderOobRibbonButtons(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const location = await pickLocation(target.document, target.view);
  if (!location) {
    return;
  }

  const commands = await pickOobCommandsForLocation(target.document, target.view, location, {
    placeHolder: "OOB buttons to reorder",
  });
  if (!commands?.length) {
    return;
  }

  const orderedCommands = await pickOobCommandOrder(commands);
  if (!orderedCommands) {
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Hide ${orderedCommands.length} OOB button${orderedCommands.length === 1 ? "" : "s"} and re-add them in the selected order?`,
    { modal: true },
    "Reorder",
  );
  if (choice !== "Reorder") {
    return;
  }

  const usedIds = collectRibbonIds(target.document);
  const baseSequence = nextCustomActionSequence(target.view);
  const inputs = orderedCommands.map((command, index) => {
    const ids = makeCustomButtonIds(
      target.document,
      target.view.scope,
      `${command.label} ${command.id}`,
    );
    const customActionId = nextBatchId(usedIds, ids.customActionId);
    const buttonId = nextBatchId(usedIds, ids.buttonId);
    const labelLocId = nextBatchId(usedIds, ids.labelLocId ?? `${buttonId}.Label`);
    const hideActionId = nextBatchId(
      usedIds,
      nextHideActionId(target.document, {
        hideActionId: makeHideActionId(
          target.document,
          target.view.scope,
          getOobControlId(command),
        ),
      }),
    );

    return {
      hideActionId,
      hideLocation: getOobControlId(command),
      customActionId,
      location,
      sequence: baseSequence + index * 10,
      buttonId,
      commandId: getOobCommandId(command),
      labelLocId,
      image16x16: command.image16x16,
      image32x32: command.image32x32,
      templateAlias: command.templateAlias,
      locLabel: {
        id: labelLocId,
        languageCode: 1033,
        description: command.label,
      },
    };
  });

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createOobButtonReorderPatches(target.document, inputs),
  );
  ctx.ribbonExplorer.refresh();
}

export async function addRibbonCommandDefinition(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const id = await showRibbonInputBox({
    prompt: "Command definition id",
    placeHolder: `d365tools.${target.document.entityLogicalName ?? "application"}.${target.view.scope}.Command`,
    validateInput: (value) => validateUniqueId(target.document, value, "Command id is required."),
  });
  if (!id) {
    return;
  }

  const action = await promptOptionalCommandAction(ctx);
  if (action === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createCommandDefinitionPatches(target.document, {
      id: id.trim(),
      action: action ?? undefined,
    }),
  );
  ctx.ribbonExplorer.refresh();
}

export async function overrideOobRibbonCommand(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const command = await pickOobCommand(target.document, target.view, {
    placeHolder: "OOB command to override",
    manualDescription: "Use a custom OOB command id",
  });
  if (!command) {
    return;
  }

  const commandId = getOobCommandId(command);
  const duplicate = validateUniqueId(target.document, commandId, "Command id is required.");
  if (duplicate) {
    vscode.window.showWarningMessage(`Cannot override '${commandId}': ${duplicate}`);
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Override OOB command '${commandId}'? This can replace default Dynamics behavior.`,
    { modal: true },
    "Override",
  );
  if (choice !== "Override") {
    return;
  }

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createCommandDefinitionPatches(target.document, {
      id: commandId,
    }),
  );
  ctx.ribbonExplorer.refresh();
}

export async function addRibbonCommandAction(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveCommandTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a command definition first.");
    return;
  }

  const action = await promptCommandAction(ctx);
  if (!action) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(target.document, [
    createCommandActionPatch(target.document, target.command, action),
  ]);
  ctx.ribbonExplorer.refresh();
}

export async function addRibbonCommandEnableRuleRef(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addRibbonCommandRuleRef(ctx, node, "EnableRule");
}

export async function addRibbonCommandDisplayRuleRef(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addRibbonCommandRuleRef(ctx, node, "DisplayRule");
}

export async function addRibbonEnableRule(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addRibbonRule(ctx, node, "Enable");
}

export async function addRibbonDisplayRule(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await addRibbonRule(ctx, node, "Display");
}

export async function addRibbonLocLabel(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const id = await showRibbonInputBox({
    prompt: "Loc label id",
    placeHolder: `d365tools.${target.document.entityLogicalName ?? "application"}.${target.view.scope}.Label`,
    validateInput: (value) => validateUniqueId(target.document, value, "Label id is required."),
  });
  if (!id) {
    return;
  }

  const description = await showRibbonInputBox({
    prompt: "Text",
    placeHolder: "Validate and save",
    validateInput: (value) => (value.trim() ? undefined : "Text is required."),
  });
  if (!description) {
    return;
  }

  const languageCode = await promptRibbonLanguageCode();
  if (languageCode === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createLocLabelPatches(target.document, {
      id: id.trim(),
      languageCode,
      description: description.trim(),
    }),
  );
  ctx.ribbonExplorer.refresh();
}

export async function addRibbonLocLabelTitle(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const target = resolveLocLabelTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a LocLabel first.");
    return;
  }

  const languageCode = await promptRibbonLanguageCode({
    unavailableLanguageCodes: target.label.titles.map((title) => title.languageCode),
  });
  if (languageCode === undefined) {
    return;
  }

  const description = await showRibbonInputBox({
    prompt: "Text",
    placeHolder: "Validate and save",
    validateInput: (value) => (value.trim() ? undefined : "Text is required."),
  });
  if (description === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(target.document, [
    createLocLabelTitlePatch(target.document, target.label.range, {
      languageCode,
      description: description.trim(),
    }),
  ]);
  ctx.ribbonExplorer.refresh();
}

export async function moveRibbonNodeUp(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await moveRibbonNode(ctx, node, -1);
}

export async function moveRibbonNodeDown(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  await moveRibbonNode(ctx, node, 1);
}

function resolveSourceId(node: unknown): string | undefined {
  if (node instanceof RibbonSourceNode) {
    return node.source.id;
  }

  if (node instanceof RibbonDocumentNode) {
    return node.document.sourceId;
  }

  if (node instanceof RibbonViewNode || node instanceof RibbonSectionNode) {
    return node.document.sourceId;
  }

  if (node instanceof RibbonItemNode) {
    return node.editTarget?.document.sourceId;
  }

  return undefined;
}

async function resolveSource(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
): Promise<RibbonSource | undefined> {
  if (node instanceof RibbonSourceNode) {
    return node.source;
  }

  const sourceId = resolveSourceId(node);
  if (!sourceId) {
    return undefined;
  }

  const sources = await ctx.ribbonSourceLocator.locate(ctx.configuration.workspaceRoot);
  return sources.find((source) => source.id === sourceId);
}

function resolveRibbonTarget(
  node: RibbonExplorerNode | undefined,
): { document: RibbonDocument; view: RibbonView } | undefined {
  if (node instanceof RibbonViewNode) {
    return { document: node.document, view: node.view };
  }

  if (node instanceof RibbonSectionNode) {
    return { document: node.document, view: node.view };
  }

  if (node instanceof RibbonDocumentNode && node.document.kind === "Application") {
    return { document: node.document, view: node.document.views[0] };
  }

  return undefined;
}

function resolveCommandTarget(
  node: RibbonExplorerNode | undefined,
): { document: RibbonDocument; command: CommandDefinition } | undefined {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    return undefined;
  }

  if (
    !node.contextValue.includes("d365RibbonCommandDefinition") &&
    node.contextValue !== "d365RibbonActions"
  ) {
    return undefined;
  }

  for (const view of node.editTarget.document.views) {
    const command = view.commandDefinitions.find(
      (item) =>
        item.range.start === node.editTarget?.range.start &&
        item.range.end === node.editTarget.range.end,
    );
    if (command) {
      return { document: node.editTarget.document, command };
    }
  }

  return undefined;
}

function resolveLocLabelTarget(
  node: RibbonExplorerNode | undefined,
): { document: RibbonDocument; label: LocLabel } | undefined {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    return undefined;
  }

  if (node.contextValue !== "d365RibbonLocLabel") {
    return undefined;
  }

  const target = node.editTarget;
  for (const view of target.document.views) {
    const label = view.locLabels.find((item) => sameRange(item.range, target.range));
    if (label) {
      return { document: target.document, label };
    }
  }

  return undefined;
}

type EditableTarget =
  | { kind: "CustomAction"; document: RibbonDocument; action: CustomAction }
  | { kind: "HideAction"; document: RibbonDocument; action: HideAction }
  | { kind: "CommandDefinition"; document: RibbonDocument; command: CommandDefinition }
  | { kind: "EnableRule"; document: RibbonDocument; rule: EnableRule }
  | { kind: "DisplayRule"; document: RibbonDocument; rule: DisplayRule }
  | { kind: "LocLabel"; document: RibbonDocument; label: LocLabel }
  | { kind: "CommandAction"; document: RibbonDocument; action: CommandAction }
  | {
      kind: "RuleStep";
      document: RibbonDocument;
      ruleKind: "Enable" | "Display";
      step: RuleStep;
    }
  | { kind: "LocLabelTitle"; document: RibbonDocument; title: LocLabelTitle };

type ReorderTarget = {
  document: RibbonDocument;
  ranges: Array<{ start: number; end: number }>;
  index: number;
};

type ReorderIdentity =
  | { kind: "CustomAction"; id: string }
  | { kind: "HideAction"; id: string }
  | { kind: "CommandDefinition"; id: string }
  | { kind: "EnableRule"; id: string }
  | { kind: "DisplayRule"; id: string }
  | { kind: "LocLabel"; id: string }
  | { kind: "LocLabelTitle"; labelId: string; languageCode: number }
  | {
      kind: "ActionParameter";
      parent: ParameterParentIdentity;
      parameterKind: ActionParameter["kind"];
      value: string;
      occurrence: number;
    };

type ParameterParentIdentity =
  | { kind: "CommandAction"; commandId: string; actionIndex: number }
  | {
      kind: "RuleStep";
      ruleKind: "EnableRule" | "DisplayRule";
      ruleId: string;
      stepIndex: number;
    };

async function moveRibbonNode(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
  direction: -1 | 1,
): Promise<void> {
  const target = await resolveReorderTarget(ctx, node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon item that can be moved.");
    return;
  }

  const nextIndex = target.index + direction;
  if (nextIndex < 0 || nextIndex >= target.ranges.length) {
    vscode.window.showWarningMessage(
      direction < 0 ? "Item is already first." : "Item is already last.",
    );
    return;
  }

  ctx.ribbonEditorState.queuePatches(
    target.document,
    createSwapNodePatches(
      target.document.sourceText,
      target.ranges[target.index],
      target.ranges[nextIndex],
    ),
  );
  ctx.ribbonExplorer.refresh();
}

async function resolveReorderTarget(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
): Promise<ReorderTarget | undefined> {
  if (!(node instanceof RibbonItemNode) || !node.editTarget) {
    return undefined;
  }

  const target = node.editTarget;
  const identity = resolveReorderIdentity(node, target.document, target.range);
  const currentDocument = await resolveCurrentRibbonDocument(ctx, node, target.document);
  return resolveReorderTargetInDocument(
    node.contextValue,
    currentDocument ?? target.document,
    target.range,
    identity,
  );
}

async function resolveCurrentRibbonDocument(
  ctx: CommandContext,
  node: RibbonExplorerNode,
  document: RibbonDocument,
): Promise<RibbonDocument | undefined> {
  const source = await resolveSource(ctx, node);
  if (!source) {
    return undefined;
  }

  const documents = await ctx.ribbonEditorState.loadSource(source);
  return (
    documents.find((item) => item.id === document.id) ??
    documents.find(
      (item) =>
        item.fileUri === document.fileUri &&
        item.kind === document.kind &&
        item.entityLogicalName === document.entityLogicalName,
    )
  );
}

function resolveReorderTargetInDocument(
  contextValue: string,
  document: RibbonDocument,
  range: TextRange,
  identity: ReorderIdentity | undefined,
): ReorderTarget | undefined {
  for (const view of document.views) {
    const customAction =
      identity?.kind === "CustomAction"
        ? view.customActions.findIndex((item) => item.id === identity.id)
        : findRangeIndex(view.customActions, range);
    if (contextValue === "d365RibbonCustomAction" && customAction >= 0) {
      return {
        document,
        ranges: view.customActions.map((item) => item.range),
        index: customAction,
      };
    }

    const hideAction =
      identity?.kind === "HideAction"
        ? view.hideActions.findIndex((item) => item.hideActionId === identity.id)
        : findRangeIndex(view.hideActions, range);
    if (contextValue === "d365RibbonHideAction" && hideAction >= 0) {
      return {
        document,
        ranges: view.hideActions.map((item) => item.range),
        index: hideAction,
      };
    }

    const commandDefinition =
      identity?.kind === "CommandDefinition"
        ? view.commandDefinitions.findIndex((item) => item.id === identity.id)
        : findRangeIndex(view.commandDefinitions, range);
    if (contextValue === "d365RibbonCommandDefinition" && commandDefinition >= 0) {
      return {
        document,
        ranges: view.commandDefinitions.map((item) => item.range),
        index: commandDefinition,
      };
    }

    const enableRule =
      identity?.kind === "EnableRule"
        ? view.enableRules.findIndex((item) => item.id === identity.id)
        : findRangeIndex(view.enableRules, range);
    if (contextValue === "d365RibbonEnableRule" && enableRule >= 0) {
      return {
        document,
        ranges: view.enableRules.map((item) => item.range),
        index: enableRule,
      };
    }

    const displayRule =
      identity?.kind === "DisplayRule"
        ? view.displayRules.findIndex((item) => item.id === identity.id)
        : findRangeIndex(view.displayRules, range);
    if (contextValue === "d365RibbonDisplayRule" && displayRule >= 0) {
      return {
        document,
        ranges: view.displayRules.map((item) => item.range),
        index: displayRule,
      };
    }

    const locLabel =
      identity?.kind === "LocLabel"
        ? view.locLabels.findIndex((item) => item.id === identity.id)
        : findRangeIndex(view.locLabels, range);
    if (contextValue === "d365RibbonLocLabel" && locLabel >= 0) {
      return {
        document,
        ranges: view.locLabels.map((item) => item.range),
        index: locLabel,
      };
    }

    for (const command of view.commandDefinitions) {
      const action = findCommandActionIndex(command, range, identity);
      if (
        (contextValue === "d365RibbonJavaScriptAction" || contextValue === "d365RibbonUrlAction") &&
        action >= 0
      ) {
        return {
          document,
          ranges: command.actions.map((item) => item.range),
          index: action,
        };
      }

      const commandParameter = findCommandActionParameterTarget(command, range, identity);
      if (contextValue === "d365RibbonParameter" && commandParameter) {
        return {
          document,
          ranges: commandParameter.parameters
            .map((parameter) => parameter.range)
            .filter((parameterRange): parameterRange is TextRange => Boolean(parameterRange)),
          index: commandParameter.index,
        };
      }
    }

    for (const rule of view.enableRules) {
      const step = findRangeIndex(rule.steps, range);
      if (contextValue.startsWith("d365RibbonRuleStep:") && step >= 0) {
        return {
          document,
          ranges: rule.steps.map((item) => item.range),
          index: step,
        };
      }

      const ruleParameter = findRuleStepParameterTarget(rule, "EnableRule", range, identity);
      if (contextValue === "d365RibbonParameter" && ruleParameter) {
        return {
          document,
          ranges: ruleParameter.parameters
            .map((parameter) => parameter.range)
            .filter((parameterRange): parameterRange is TextRange => Boolean(parameterRange)),
          index: ruleParameter.index,
        };
      }
    }

    for (const rule of view.displayRules) {
      const step = findRangeIndex(rule.steps, range);
      if (contextValue.startsWith("d365RibbonRuleStep:") && step >= 0) {
        return {
          document,
          ranges: rule.steps.map((item) => item.range),
          index: step,
        };
      }

      const ruleParameter = findRuleStepParameterTarget(rule, "DisplayRule", range, identity);
      if (contextValue === "d365RibbonParameter" && ruleParameter) {
        return {
          document,
          ranges: ruleParameter.parameters
            .map((parameter) => parameter.range)
            .filter((parameterRange): parameterRange is TextRange => Boolean(parameterRange)),
          index: ruleParameter.index,
        };
      }
    }

    for (const label of view.locLabels) {
      const title =
        identity?.kind === "LocLabelTitle"
          ? label.id === identity.labelId
            ? label.titles.findIndex((item) => item.languageCode === identity.languageCode)
            : -1
          : findRangeIndex(label.titles, range);
      if (contextValue === "d365RibbonLocLabelTitle" && title >= 0) {
        return {
          document,
          ranges: label.titles.map((item) => item.range),
          index: title,
        };
      }
    }
  }

  return undefined;
}

function resolveReorderIdentity(
  node: RibbonItemNode,
  document: RibbonDocument,
  range: TextRange,
): ReorderIdentity | undefined {
  for (const view of document.views) {
    const customAction = view.customActions.find((item) => sameRange(item.range, range));
    if (node.contextValue === "d365RibbonCustomAction" && customAction) {
      return { kind: "CustomAction", id: customAction.id };
    }

    const hideAction = view.hideActions.find((item) => sameRange(item.range, range));
    if (node.contextValue === "d365RibbonHideAction" && hideAction) {
      return { kind: "HideAction", id: hideAction.hideActionId };
    }

    const commandDefinition = view.commandDefinitions.find((item) => sameRange(item.range, range));
    if (node.contextValue === "d365RibbonCommandDefinition" && commandDefinition) {
      return { kind: "CommandDefinition", id: commandDefinition.id };
    }

    for (const command of view.commandDefinitions) {
      const actionIndex = command.actions.findIndex((action) =>
        action.kind === "JavaScriptFunction"
          ? action.parameters.some(
              (parameter) => parameter.range && sameRange(parameter.range, range),
            )
          : false,
      );
      const action = command.actions[actionIndex];
      if (node.contextValue === "d365RibbonParameter" && action?.kind === "JavaScriptFunction") {
        const parameterIndex = action.parameters.findIndex(
          (parameter) => parameter.range && sameRange(parameter.range, range),
        );
        const parameter = action.parameters[parameterIndex];
        if (parameter) {
          return {
            kind: "ActionParameter",
            parent: { kind: "CommandAction", commandId: command.id, actionIndex },
            parameterKind: parameter.kind,
            value: parameter.value,
            occurrence: parameterOccurrence(action.parameters, parameterIndex),
          };
        }
      }
    }

    const enableRule = view.enableRules.find((item) => sameRange(item.range, range));
    if (node.contextValue === "d365RibbonEnableRule" && enableRule) {
      return { kind: "EnableRule", id: enableRule.id };
    }

    for (const rule of view.enableRules) {
      const identity = ruleStepParameterIdentity(rule, "EnableRule", range);
      if (node.contextValue === "d365RibbonParameter" && identity) {
        return identity;
      }
    }

    const displayRule = view.displayRules.find((item) => sameRange(item.range, range));
    if (node.contextValue === "d365RibbonDisplayRule" && displayRule) {
      return { kind: "DisplayRule", id: displayRule.id };
    }

    for (const rule of view.displayRules) {
      const identity = ruleStepParameterIdentity(rule, "DisplayRule", range);
      if (node.contextValue === "d365RibbonParameter" && identity) {
        return identity;
      }
    }

    for (const label of view.locLabels) {
      if (node.contextValue === "d365RibbonLocLabel" && sameRange(label.range, range)) {
        return { kind: "LocLabel", id: label.id };
      }

      const title = label.titles.find((item) => sameRange(item.range, range));
      if (node.contextValue === "d365RibbonLocLabelTitle" && title) {
        return { kind: "LocLabelTitle", labelId: label.id, languageCode: title.languageCode };
      }
    }
  }

  return undefined;
}

function findCommandActionIndex(
  command: CommandDefinition,
  range: TextRange,
  identity: ReorderIdentity | undefined,
): number {
  if (
    identity?.kind === "ActionParameter" &&
    identity.parent.kind === "CommandAction" &&
    identity.parent.commandId === command.id
  ) {
    return identity.parent.actionIndex;
  }

  return findRangeIndex(command.actions, range);
}

function findCommandActionParameterTarget(
  command: CommandDefinition,
  range: TextRange,
  identity: ReorderIdentity | undefined,
): { parameters: ActionParameter[]; index: number } | undefined {
  for (const [actionIndex, action] of command.actions.entries()) {
    if (action.kind !== "JavaScriptFunction") {
      continue;
    }

    if (
      identity?.kind === "ActionParameter" &&
      identity.parent.kind === "CommandAction" &&
      identity.parent.commandId === command.id &&
      identity.parent.actionIndex === actionIndex
    ) {
      const index = findParameterByIdentity(action.parameters, identity);
      return index >= 0 ? { parameters: action.parameters, index } : undefined;
    }

    const index = findParameterRangeIndex(action.parameters, range);
    if (index >= 0) {
      return { parameters: action.parameters, index };
    }
  }

  return undefined;
}

function findRuleStepParameterTarget(
  rule: EnableRule | DisplayRule,
  ruleKind: "EnableRule" | "DisplayRule",
  range: TextRange,
  identity: ReorderIdentity | undefined,
): { parameters: ActionParameter[]; index: number } | undefined {
  for (const [stepIndex, step] of rule.steps.entries()) {
    if (step.kind !== "CustomRule") {
      continue;
    }

    if (
      identity?.kind === "ActionParameter" &&
      identity.parent.kind === "RuleStep" &&
      identity.parent.ruleKind === ruleKind &&
      identity.parent.ruleId === rule.id &&
      identity.parent.stepIndex === stepIndex
    ) {
      const index = findParameterByIdentity(step.parameters, identity);
      return index >= 0 ? { parameters: step.parameters, index } : undefined;
    }

    const index = findParameterRangeIndex(step.parameters, range);
    if (index >= 0) {
      return { parameters: step.parameters, index };
    }
  }

  return undefined;
}

function ruleStepParameterIdentity(
  rule: EnableRule | DisplayRule,
  ruleKind: "EnableRule" | "DisplayRule",
  range: TextRange,
): ReorderIdentity | undefined {
  for (const [stepIndex, step] of rule.steps.entries()) {
    if (step.kind !== "CustomRule") {
      continue;
    }

    const parameterIndex = findParameterRangeIndex(step.parameters, range);
    const parameter = step.parameters[parameterIndex];
    if (!parameter) {
      continue;
    }

    return {
      kind: "ActionParameter",
      parent: { kind: "RuleStep", ruleKind, ruleId: rule.id, stepIndex },
      parameterKind: parameter.kind,
      value: parameter.value,
      occurrence: parameterOccurrence(step.parameters, parameterIndex),
    };
  }

  return undefined;
}

function findParameterByIdentity(
  parameters: ActionParameter[],
  identity: Extract<ReorderIdentity, { kind: "ActionParameter" }>,
): number {
  let occurrence = 0;

  return parameters.findIndex((parameter) => {
    if (parameter.kind !== identity.parameterKind || parameter.value !== identity.value) {
      return false;
    }

    const matches = occurrence === identity.occurrence;
    occurrence += 1;
    return matches;
  });
}

function parameterOccurrence(parameters: ActionParameter[], index: number): number {
  const target = parameters[index];
  if (!target) {
    return -1;
  }

  return parameters
    .slice(0, index)
    .filter((parameter) => parameter.kind === target.kind && parameter.value === target.value)
    .length;
}

function findParameterRangeIndex(parameters: ActionParameter[], range: TextRange): number {
  return parameters.findIndex((parameter) => parameter.range && sameRange(parameter.range, range));
}

function findRangeIndex<T extends { range: { start: number; end: number } }>(
  items: T[],
  range: { start: number; end: number },
): number {
  return items.findIndex((item) => sameRange(item.range, range));
}

function resolveEditableTarget(node: RibbonItemNode): EditableTarget | undefined {
  const target = node.editTarget;
  if (!target) {
    return undefined;
  }

  for (const view of target.document.views) {
    const customAction = view.customActions.find((item) => sameRange(item.range, target.range));
    if (customAction && node.contextValue === "d365RibbonCustomAction") {
      return { kind: "CustomAction", document: target.document, action: customAction };
    }

    const hideAction = view.hideActions.find((item) => sameRange(item.range, target.range));
    if (hideAction) {
      return { kind: "HideAction", document: target.document, action: hideAction };
    }

    for (const command of view.commandDefinitions) {
      if (
        sameRange(command.range, target.range) &&
        node.contextValue === "d365RibbonCommandDefinition"
      ) {
        return { kind: "CommandDefinition", document: target.document, command };
      }

      const action = command.actions.find((item) => sameRange(item.range, target.range));
      if (action && action.kind !== "Unknown") {
        return { kind: "CommandAction", document: target.document, action };
      }
    }

    for (const rule of view.enableRules) {
      if (sameRange(rule.range, target.range) && node.contextValue === "d365RibbonEnableRule") {
        return { kind: "EnableRule", document: target.document, rule };
      }

      const step = rule.steps.find((item) => sameRange(item.range, target.range));
      if (step && step.kind !== "Unknown") {
        return { kind: "RuleStep", document: target.document, ruleKind: "Enable", step };
      }
    }

    for (const rule of view.displayRules) {
      if (sameRange(rule.range, target.range) && node.contextValue === "d365RibbonDisplayRule") {
        return { kind: "DisplayRule", document: target.document, rule };
      }

      const step = rule.steps.find((item) => sameRange(item.range, target.range));
      if (step && step.kind !== "Unknown") {
        return { kind: "RuleStep", document: target.document, ruleKind: "Display", step };
      }
    }

    for (const label of view.locLabels) {
      if (sameRange(label.range, target.range) && node.contextValue === "d365RibbonLocLabel") {
        return { kind: "LocLabel", document: target.document, label };
      }

      const title = label.titles.find((item) => sameRange(item.range, target.range));
      if (title) {
        return { kind: "LocLabelTitle", document: target.document, title };
      }
    }
  }

  return undefined;
}

function sameRange(left: { start: number; end: number }, right: { start: number; end: number }) {
  return left.start === right.start && left.end === right.end;
}

async function editCustomAction(
  ctx: CommandContext,
  document: RibbonDocument,
  action: CustomAction,
): Promise<void> {
  if (action.commandUI?.kind !== "Button") {
    vscode.window.showWarningMessage("Only Button custom actions can be edited.");
    return;
  }

  const customActionId = await promptRequired("Custom action id", action.id);
  if (customActionId === undefined) {
    return;
  }

  const location = await promptRequired("Location", action.location);
  if (location === undefined) {
    return;
  }

  const sequenceText = await showRibbonInputBox({
    prompt: "Sequence",
    value: action.sequence === undefined ? "" : String(action.sequence),
    validateInput: validateOptionalNumber,
  });
  if (sequenceText === undefined) {
    return;
  }

  const buttonId = await promptRequired("Button id", action.commandUI.id);
  if (buttonId === undefined) {
    return;
  }

  const commandId = await promptRequired("Command id", action.commandUI.command);
  if (commandId === undefined) {
    return;
  }

  const labelLocId = await promptOptional("Label LocLabel id", action.commandUI.labelLocId);
  if (labelLocId === undefined) {
    return;
  }

  const labelText = await promptOptional("Inline label text", action.commandUI.labelText);
  if (labelText === undefined) {
    return;
  }

  const image16x16 = await promptOptional(
    "Small icon web resource",
    action.commandUI.image16x16?.webResourceUniqueName,
  );
  if (image16x16 === undefined) {
    return;
  }

  const image32x32 = await promptOptional(
    "Large icon web resource",
    action.commandUI.image32x32?.webResourceUniqueName,
  );
  if (image32x32 === undefined) {
    return;
  }

  const templateAlias = await promptOptional("Template alias", action.commandUI.templateAlias);
  if (templateAlias === undefined) {
    return;
  }

  const input: NewCustomButtonInput = {
    customActionId: customActionId.trim(),
    location: location.trim(),
    sequence: sequenceText.trim() ? Number(sequenceText.trim()) : undefined,
    buttonId: buttonId.trim(),
    commandId: commandId.trim(),
    action: { kind: "Url", address: "" },
    labelLocId: labelLocId.trim() || undefined,
    labelText: labelText.trim() || undefined,
    image16x16: image16x16.trim() || undefined,
    image32x32: image32x32.trim() || undefined,
    templateAlias: templateAlias.trim() || undefined,
  };

  ctx.ribbonEditorState.queuePatches(document, [
    createCustomButtonReplacePatch(document.sourceText, action.range, input),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function editHideAction(
  ctx: CommandContext,
  document: RibbonDocument,
  action: HideAction,
): Promise<void> {
  const hideActionId = await promptRequired("Hide action id", action.hideActionId);
  if (hideActionId === undefined) {
    return;
  }

  const location = await promptRequired("Location", action.location);
  if (location === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(document, [
    createHideActionReplacePatch(document.sourceText, action.range, {
      hideActionId: hideActionId.trim(),
      location: location.trim(),
    }),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function editNodeId(
  ctx: CommandContext,
  document: RibbonDocument,
  range: { start: number; end: number },
  prompt: string,
  currentId: string,
): Promise<void> {
  const id = await showRibbonInputBox({
    prompt,
    value: currentId,
    validateInput: (value) =>
      validateUniqueId(document, value, `${prompt} is required.`, currentId),
  });
  if (id === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(document, [
    createNodeAttributeValuePatch(document.sourceText, range, "Id", id.trim()),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function editCommandAction(
  ctx: CommandContext,
  document: RibbonDocument,
  action: CommandAction,
): Promise<void> {
  const input = await promptCommandAction(ctx, action);
  if (!input) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(document, [
    createCommandActionReplacePatch(document.sourceText, action, input),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function editRuleStep(
  ctx: CommandContext,
  document: RibbonDocument,
  ruleKind: "Enable" | "Display",
  step: RuleStep,
): Promise<void> {
  const input = await promptRuleStep(ctx, ruleKind);
  if (!input) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(document, [
    createRuleStepReplacePatch(document.sourceText, step, input),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function editLocLabelTitle(
  ctx: CommandContext,
  document: RibbonDocument,
  title: LocLabelTitle,
): Promise<void> {
  const languageCode = await promptRibbonLanguageCode({
    currentLanguageCode: title.languageCode,
  });
  if (languageCode === undefined) {
    return;
  }

  const description = await promptRequired("Text", title.description);
  if (description === undefined) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(document, [
    createLocLabelTitleReplacePatch(document.sourceText, title, {
      languageCode,
      description: description.trim(),
    }),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function pickOobCommand(
  document: RibbonDocument,
  view: RibbonView,
  options: {
    placeHolder?: string;
    manualDescription?: string;
  } = {},
): Promise<OobRibbonCommand | undefined> {
  const commands = listOobRibbonCommands(view.scope, document.entityLogicalName);
  const manual: OobCommandPick = {
    label: "Type command id",
    description: options.manualDescription ?? "Use a custom OOB command id",
    manual: true,
  };
  const items: OobCommandPick[] = [
    ...commands.map((command) => ({
      label: command.id,
      description: command.label,
      command,
    })),
    manual,
  ];
  const pick = await showRibbonQuickPick<OobCommandPick>(items, {
    placeHolder: options.placeHolder ?? "OOB button command to hide",
  });

  if (!pick) {
    return undefined;
  }

  if (pick.command) {
    return pick.command;
  }

  const id = await showRibbonInputBox({
    prompt: "OOB command id",
    placeHolder: "Mscrm.SavePrimary",
    validateInput: (value) => (value.trim() ? undefined : "Command id is required."),
  });

  return id
    ? {
        id: id.trim(),
        label: id.trim(),
        scopes: [view.scope],
        locationIds: [],
        commandId: id.trim(),
      }
    : undefined;
}

async function pickOobCommandsForLocation(
  document: RibbonDocument,
  view: RibbonView,
  location: string,
  options: { placeHolder?: string } = {},
): Promise<OobRibbonCommand[] | undefined> {
  const catalogLocation = listOobRibbonLocations(view.scope, document.entityLogicalName).find(
    (item) => item.location === location,
  );
  const commands = listOobRibbonCommands(view.scope, document.entityLogicalName);
  const suggested = catalogLocation
    ? commands.filter((command) => command.locationIds.includes(catalogLocation.id))
    : commands;
  const picks = await showRibbonQuickPick<OobCommandPick>(
    suggested.map((command) => ({
      label: command.id,
      description: command.label,
      command,
    })),
    {
      canPickMany: true,
      placeHolder: catalogLocation
        ? `OOB buttons in ${catalogLocation.label}`
        : (options.placeHolder ?? "OOB buttons to hide and stub"),
    },
  );

  return picks
    ?.map((pick) => pick.command)
    .filter((command): command is OobRibbonCommand => Boolean(command));
}

async function pickOobCommandOrder(
  commands: OobRibbonCommand[],
): Promise<OobRibbonCommand[] | undefined> {
  if (commands.length <= 1) {
    return commands;
  }

  const remaining = commands.slice();
  const ordered: OobRibbonCommand[] = [];

  while (remaining.length) {
    const pick = await showRibbonQuickPick<OobCommandPick>(
      remaining.map((command) => ({
        label: command.id,
        description: command.label,
        command,
      })),
      {
        placeHolder: `Pick button ${ordered.length + 1} of ${commands.length}`,
      },
    );
    if (!pick?.command) {
      return undefined;
    }

    ordered.push(pick.command);
    remaining.splice(
      remaining.findIndex((command) => command.id === pick.command?.id),
      1,
    );
  }

  return ordered;
}

async function pickLocation(
  document: RibbonDocument,
  view: RibbonView,
  command?: OobRibbonCommand,
): Promise<string | undefined> {
  const suggestedLocations = (command?.locationIds ?? [])
    .map((id) => findOobRibbonLocation(id, document.entityLogicalName))
    .filter((location): location is NonNullable<typeof location> => !!location);
  const fallbackLocations = listOobRibbonLocations(view.scope, document.entityLogicalName);
  const locations = suggestedLocations.length ? suggestedLocations : fallbackLocations;
  const pick = await showRibbonQuickPick(
    [
      ...locations.map((location) => ({
        label: location.location,
        description: location.label,
      })),
      { label: "Type location", description: "Use a custom location id" },
    ],
    { placeHolder: "Ribbon location" },
  );

  if (!pick) {
    return undefined;
  }

  if (pick.label !== "Type location") {
    return pick.label;
  }

  return showRibbonInputBox({
    prompt: "Ribbon location",
    placeHolder: "Mscrm.Form.account.MainTab.Save.Controls._children",
    validateInput: (value) => (value.trim() ? undefined : "Location is required."),
  });
}

async function pickHideLocation(
  document: RibbonDocument,
  view: RibbonView,
  command: OobRibbonCommand,
): Promise<string | undefined> {
  if (command.controlId) {
    return command.controlId;
  }

  return pickLocation(document, view, command);
}

function getOobCommandId(command: OobRibbonCommand): string {
  return command.commandId || command.id;
}

function getOobControlId(command: OobRibbonCommand): string {
  return command.controlId || command.id;
}

async function promptJavaScriptAction(
  ctx: CommandContext,
  current?: Extract<CommandAction, { kind: "JavaScriptFunction" }>,
): Promise<NewCommandActionInput | undefined> {
  const library = await pickWebResourceLibrary(ctx, current?.library.uniqueName);
  if (!library) {
    return undefined;
  }

  const functionName = await pickJavaScriptFunctionName(library, current?.functionName);
  if (!functionName) {
    return undefined;
  }

  const parameters = await promptCrmParameters(current?.parameters);
  if (parameters === undefined) {
    return undefined;
  }

  return {
    kind: "JavaScriptFunction" as const,
    library: library.uniqueName,
    functionName: functionName.trim(),
    parameters,
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

async function promptCommandAction(
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
    ? promptUrlAction(current?.kind === "Url" ? current.address : undefined)
    : promptJavaScriptAction(ctx, current?.kind === "JavaScriptFunction" ? current : undefined);
}

async function promptOptionalCommandAction(
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

async function promptUrlAction(currentAddress?: string) {
  const address = await showRibbonInputBox({
    prompt: "URL",
    placeHolder: "https://contoso.example",
    value: currentAddress ?? "",
    validateInput: (value) => (value.trim() ? undefined : "URL is required."),
  });
  if (!address) {
    return undefined;
  }

  return {
    kind: "Url" as const,
    address: address.trim(),
  };
}

function promptRequired(prompt: string, value: string | undefined): Thenable<string | undefined> {
  return showRibbonInputBox({
    prompt,
    value: value ?? "",
    validateInput: (input) => (input.trim() ? undefined : `${prompt} is required.`),
  });
}

function promptOptional(prompt: string, value: string | undefined): Thenable<string | undefined> {
  return showRibbonInputBox({
    prompt,
    value: value ?? "",
  });
}

function validateOptionalNumber(value: string): string | undefined {
  return value.trim() === "" || /^\d+$/.test(value.trim()) ? undefined : "Use a number.";
}

async function pickWebResourceLibrary(
  ctx: CommandContext,
  currentUniqueName?: string,
): Promise<WebResourceLibraryPick | undefined> {
  const picks = currentWebResourceFirst(await listBoundJavaScriptLibraries(ctx), currentUniqueName);
  const manualPick: WebResourceLibraryPick = {
    label: "Type schema name manually",
    description: "Use an external or unbound web resource",
    uniqueName: "",
    manual: true,
  };

  const pick = await showRibbonQuickPick([...picks, manualPick], {
    placeHolder: "JavaScript web resource",
  });
  if (!pick) {
    return undefined;
  }

  if (!pick.manual) {
    return pick;
  }

  const uniqueName = await showRibbonInputBox({
    prompt: "JavaScript web resource schema name",
    placeHolder: "new_/scripts/account.js",
    value: currentUniqueName ?? "",
    validateInput: (value) =>
      normalizeWebResourceUniqueName(value) ? undefined : "Schema name is required.",
  });
  const normalized = normalizeWebResourceUniqueName(uniqueName ?? "");

  return normalized
    ? {
        label: normalized,
        uniqueName: normalized,
      }
    : undefined;
}

export async function listBoundJavaScriptLibraries(
  ctx: CommandContext,
): Promise<WebResourceLibraryPick[]> {
  const snapshot = await ctx.bindings.listBindings();
  const picks: WebResourceLibraryPick[] = [];

  for (const binding of snapshot.bindings) {
    if (binding.kind === "file") {
      const uniqueName = binding.remotePath.replace(/\\/g, "/");
      if (uniqueName.toLowerCase().endsWith(".js")) {
        picks.push({
          label: uniqueName,
          description: ctx.configuration.getRelativeToWorkspace(
            ctx.configuration.resolveLocalPath(binding.relativeLocalPath),
          ),
          uniqueName,
          localPath: ctx.configuration.resolveLocalPath(binding.relativeLocalPath),
        });
      }
      continue;
    }

    picks.push(...(await listFolderJavaScriptLibraries(ctx, binding)));
  }

  return uniqueByWebResourceUniqueName(picks).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

async function listFolderJavaScriptLibraries(
  ctx: CommandContext,
  binding: BindingEntry,
): Promise<WebResourceLibraryPick[]> {
  const root = ctx.configuration.resolveLocalPath(binding.relativeLocalPath);
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(root, "**/*.js"),
    "**/node_modules/**",
  );

  return files.map((file) => {
    const relative = path.relative(root, file.fsPath).replace(/\\/g, "/");
    const uniqueName = joinRemotePath(binding.remotePath, relative);
    return {
      label: uniqueName,
      description: ctx.configuration.getRelativeToWorkspace(file.fsPath),
      uniqueName,
      localPath: file.fsPath,
    };
  });
}

async function pickJavaScriptFunctionName(
  library: WebResourceLibraryPick,
  currentFunctionName?: string,
): Promise<string | undefined> {
  const suggestions = withDefaultJavaScriptFunctionSuggestions(
    await listJavaScriptFunctionSuggestions(library.localPath),
  );
  if (!suggestions.length) {
    return showRibbonInputBox({
      prompt: "JavaScript function name",
      placeHolder: "validateAndSave",
      value: currentFunctionName ?? "",
      validateInput: (value) => (value.trim() ? undefined : "Function name is required."),
    });
  }

  const manual = "Type function name";
  const suggestionItems = currentFunctionFirst(suggestions, currentFunctionName).map((name) => ({
    label: name,
    description:
      currentFunctionName && isCurrentFunctionSuggestion(name, currentFunctionName)
        ? "Current function"
        : undefined,
  }));
  const pick = await showRibbonQuickPick([...suggestionItems, { label: manual }], {
    placeHolder: "JavaScript function name",
  });
  if (!pick) {
    return undefined;
  }

  if (pick.label !== manual) {
    return pick.label;
  }

  return showRibbonInputBox({
    prompt: "JavaScript function name",
    placeHolder: "validateAndSave",
    value: currentFunctionName ?? "",
    validateInput: (value) => (value.trim() ? undefined : "Function name is required."),
  });
}

async function listJavaScriptFunctionSuggestions(localPath: string | undefined): Promise<string[]> {
  if (!localPath) {
    return [];
  }

  const stat = await vscode.workspace.fs.stat(vscode.Uri.file(localPath)).then(
    (value) => value,
    () => undefined,
  );
  if (!stat || stat.size > 256 * 1024) {
    return [];
  }

  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(localPath));
  const source = Buffer.from(bytes).toString("utf8");
  return extractJavaScriptFunctionSuggestions(source);
}

function withDefaultJavaScriptFunctionSuggestions(suggestions: string[]): string[] {
  const names = new Set<string>();

  for (const name of DEFAULT_JAVASCRIPT_FUNCTION_SUGGESTIONS) {
    names.add(name);
  }
  for (const name of suggestions) {
    names.add(name);
  }

  return [...names];
}

export function extractJavaScriptFunctionSuggestions(source: string): string[] {
  const names = new Set<string>();
  const namespaceAliases = getCompiledNamespaceAliases(source);
  const exportedAliases = getCompiledExportedAliases(source, namespaceAliases);
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:^|[;\n]\s*)([A-Za-z_$][\w$]*)\s*=\s*function\s*\(/g,
    /(?:^|[;\n]\s*)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*=\s*function\s*\(/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (isCompiledClassConstructor(source, name)) {
        continue;
      }
      names.add(expandCompiledFunctionName(name, namespaceAliases, exportedAliases));
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function getCompiledNamespaceAliases(source: string): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const match of source.matchAll(
    /\}\)\(\s*([A-Za-z_$][\w$]*)\s*\|\|\s*\(\s*\1\s*=\s*\{\}\s*\)\s*\)/g,
  )) {
    aliases.set(match[1], match[1]);
  }

  for (const match of source.matchAll(
    /\}\)\(\s*([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\|\|/g,
  )) {
    aliases.set(match[1], match[2]);
  }

  return aliases;
}

function getCompiledExportedAliases(
  source: string,
  namespaceAliases: Map<string, string>,
): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const match of source.matchAll(
    /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g,
  )) {
    const namespaceName = expandCompiledNamespaceName(match[1], namespaceAliases);
    if (!namespaceName) {
      continue;
    }
    aliases.set(match[3], `${namespaceName}.${match[2]}`);
  }

  return aliases;
}

function expandCompiledFunctionName(
  name: string,
  namespaceAliases: Map<string, string>,
  exportedAliases: Map<string, string>,
): string {
  const parts = name.split(".");
  const firstPart = parts[0];
  const alias = exportedAliases.get(firstPart) ?? namespaceAliases.get(firstPart);
  return alias ? [alias, ...parts.slice(1)].join(".") : name;
}

function expandCompiledNamespaceName(
  name: string,
  namespaceAliases: Map<string, string>,
): string | undefined {
  const parts = name.split(".");
  const alias = namespaceAliases.get(parts[0]);
  return alias ? [alias, ...parts.slice(1)].join(".") : undefined;
}

function isCompiledClassConstructor(source: string, name: string): boolean {
  return new RegExp(
    `\\bvar\\s+${escapeRegExp(name)}\\s*=\\s*(?:/\\*\\*[\\s\\S]*?\\*/\\s*)?\\(function\\s*\\(\\)\\s*\\{[\\s\\S]{0,512}?\\bfunction\\s+${escapeRegExp(name)}\\s*\\(`,
  ).test(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function addRibbonRule(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
  kind: "Enable" | "Display",
): Promise<void> {
  const target = resolveRibbonTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a ribbon scope first.");
    return;
  }

  const id = await showRibbonInputBox({
    prompt: `${kind} rule id`,
    placeHolder: `d365tools.${target.document.entityLogicalName ?? "application"}.${target.view.scope}.${kind}Rule`,
    validateInput: (value) => validateUniqueId(target.document, value, "Rule id is required."),
  });
  if (!id) {
    return;
  }

  const step = await promptRuleStep(ctx, kind);
  if (step === undefined) {
    return;
  }

  const createPatches = kind === "Enable" ? createEnableRulePatches : createDisplayRulePatches;
  ctx.ribbonEditorState.queuePatches(
    target.document,
    createPatches(target.document, {
      id: id.trim(),
      step: step ?? undefined,
    }),
  );
  ctx.ribbonExplorer.refresh();
}

async function addRibbonCommandRuleRef(
  ctx: CommandContext,
  node: RibbonExplorerNode | undefined,
  kind: "EnableRule" | "DisplayRule",
): Promise<void> {
  const target = resolveCommandTarget(node);
  if (!target) {
    vscode.window.showWarningMessage("Select a command definition first.");
    return;
  }

  const ruleId =
    kind === "EnableRule"
      ? await pickRuleId(
          "Enable rule",
          target.document,
          target.command.enableRuleRefs,
          (view) => view.enableRules,
        )
      : await pickRuleId(
          "Display rule",
          target.document,
          target.command.displayRuleRefs,
          (view) => view.displayRules,
        );
  if (!ruleId) {
    return;
  }

  ctx.ribbonEditorState.queuePatches(target.document, [
    createCommandRuleRefPatch(target.document, target.command, kind, ruleId.trim()),
  ]);
  ctx.ribbonExplorer.refresh();
}

async function pickRuleId<T extends EnableRule | DisplayRule>(
  label: string,
  document: RibbonDocument,
  currentRefs: string[],
  selectRules: (view: RibbonView) => T[],
): Promise<string | undefined> {
  const used = new Set(currentRefs);
  const rules = uniqueById(document.views.flatMap(selectRules)).filter(
    (rule) => !used.has(rule.id),
  );
  const manual = `Type ${label.toLowerCase()} id`;
  const pick = await showRibbonQuickPick(
    [
      ...rules.map((rule) => ({ label: rule.id })),
      { label: manual, description: "Use an id that is not in this view yet" },
    ],
    { placeHolder: label },
  );
  if (!pick) {
    return undefined;
  }

  if (pick.label !== manual) {
    return pick.label;
  }

  const id = await showRibbonInputBox({
    prompt: `${label} id`,
    validateInput: (value) => {
      const id = value.trim();
      if (!id) {
        return `${label} id is required.`;
      }
      return currentRefs.includes(id) ? "This command already references this rule." : undefined;
    },
  });
  return id?.trim();
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

function uniqueByWebResourceUniqueName(items: WebResourceLibraryPick[]): WebResourceLibraryPick[] {
  const seen = new Set<string>();
  const result: WebResourceLibraryPick[] = [];

  for (const item of items) {
    const key = normalizeWebResourceUniqueName(item.uniqueName).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }

  return result;
}

function currentWebResourceFirst(
  picks: WebResourceLibraryPick[],
  currentUniqueName: string | undefined,
): WebResourceLibraryPick[] {
  const normalized = normalizeWebResourceUniqueName(currentUniqueName ?? "");
  if (!normalized) {
    return picks;
  }

  const currentIndex = picks.findIndex(
    (pick) =>
      normalizeWebResourceUniqueName(pick.uniqueName).toLowerCase() === normalized.toLowerCase(),
  );
  if (currentIndex < 0) {
    return [
      {
        label: normalized,
        description: "Current web resource",
        uniqueName: normalized,
      },
      ...picks,
    ];
  }

  const currentPick = {
    ...picks[currentIndex],
    description: picks[currentIndex].description
      ? `${picks[currentIndex].description} - Current web resource`
      : "Current web resource",
  };
  return [currentPick, ...picks.slice(0, currentIndex), ...picks.slice(currentIndex + 1)];
}

function currentFunctionFirst(
  suggestions: string[],
  currentFunctionName: string | undefined,
): string[] {
  const current = currentFunctionName?.trim();
  if (!current) {
    return suggestions;
  }

  const currentIndex = suggestions.findIndex(
    (name) => name.toLowerCase() === current.toLowerCase(),
  );
  const suffixIndex = suggestions.findIndex((name) => isCurrentFunctionSuggestion(name, current));
  const bestIndex = currentIndex >= 0 ? currentIndex : suffixIndex;
  if (bestIndex < 0) {
    return [current, ...suggestions];
  }

  return [
    suggestions[bestIndex],
    ...suggestions.slice(0, bestIndex),
    ...suggestions.slice(bestIndex + 1),
  ];
}

function isCurrentFunctionSuggestion(suggestion: string, currentFunctionName: string): boolean {
  const suggestionKey = suggestion.toLowerCase();
  const currentKey = currentFunctionName.trim().toLowerCase();
  return suggestionKey === currentKey || suggestionKey.endsWith(`.${currentKey}`);
}

async function promptRuleStep(
  ctx: CommandContext,
  ruleKind: "Enable" | "Display",
): Promise<NewRuleStepInput | null | undefined> {
  const common = [
    { label: "CustomRule", description: "Call a JavaScript function" },
    { label: "FormStateRule", description: "Check form state" },
    { label: "CommandClientTypeRule", description: "Modern or refresh client" },
  ];
  const displayOnly = [
    { label: "ValueRule", description: "Check a field value" },
    { label: "EntityPrivilegeRule", description: "Check entity privilege" },
  ];
  const pick = await showRibbonQuickPick(
    [
      ...(ruleKind === "Display" ? displayOnly : []),
      ...common,
      { label: "No step", description: "Create an empty rule" },
    ],
    { placeHolder: "First rule step" },
  );
  if (!pick) {
    return undefined;
  }

  switch (pick.label) {
    case "No step":
      return null;
    case "CustomRule":
      return promptCustomRuleStep(ctx);
    case "FormStateRule":
      return promptFormStateRuleStep();
    case "CommandClientTypeRule":
      return promptCommandClientTypeRuleStep();
    case "ValueRule":
      return promptValueRuleStep();
    case "EntityPrivilegeRule":
      return promptEntityPrivilegeRuleStep();
    default:
      return undefined;
  }
}

async function promptCustomRuleStep(ctx: CommandContext): Promise<NewRuleStepInput | undefined> {
  const action = await promptJavaScriptAction(ctx);
  if (!action || action.kind !== "JavaScriptFunction") {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return {
    kind: "CustomRule",
    library: action.library,
    functionName: action.functionName,
    parameters: action.parameters,
    invertResult,
  };
}

async function promptFormStateRuleStep(): Promise<NewRuleStepInput | undefined> {
  const state = await showRibbonQuickPick(["Create", "Existing", "ReadOnly", "Disabled"], {
    placeHolder: "Form state",
  });
  if (!state) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return { kind: "FormStateRule", state, invertResult };
}

async function promptCommandClientTypeRuleStep(): Promise<NewRuleStepInput | undefined> {
  const type = await showRibbonQuickPick(["Modern", "Refresh"], {
    placeHolder: "Client type",
  });
  return type ? { kind: "CommandClientTypeRule", type: type as "Modern" | "Refresh" } : undefined;
}

async function promptValueRuleStep(): Promise<NewRuleStepInput | undefined> {
  const field = await showRibbonInputBox({
    prompt: "Field name",
    placeHolder: "statuscode",
    validateInput: (value) => (value.trim() ? undefined : "Field name is required."),
  });
  if (!field) {
    return undefined;
  }

  const value = await showRibbonInputBox({
    prompt: "Value",
    validateInput: (input) => (input.trim() ? undefined : "Value is required."),
  });
  if (!value) {
    return undefined;
  }

  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return { kind: "ValueRule", field: field.trim(), value: value.trim(), invertResult };
}

async function promptEntityPrivilegeRuleStep(): Promise<NewRuleStepInput | undefined> {
  const privilegeType = await showRibbonQuickPick(
    ["Create", "Read", "Write", "Delete", "Append", "AppendTo", "Assign", "Share"],
    { placeHolder: "Privilege type" },
  );
  if (!privilegeType) {
    return undefined;
  }

  const entityName = await showRibbonInputBox({
    prompt: "Entity logical name",
    placeHolder: "account",
  });
  const privilegeDepth = await showRibbonQuickPick(["Basic", "Local", "Deep", "Global"], {
    placeHolder: "Privilege depth",
  });
  const invertResult = await promptOptionalBoolean("Invert result?");
  if (invertResult === undefined) {
    return undefined;
  }

  return {
    kind: "EntityPrivilegeRule",
    entityName: entityName?.trim() || undefined,
    privilegeType,
    privilegeDepth,
    invertResult,
  };
}

async function promptOptionalBoolean(prompt: string): Promise<boolean | undefined> {
  const pick = await showRibbonQuickPick(["No", "Yes"], { placeHolder: prompt });
  if (!pick) {
    return undefined;
  }

  return pick === "Yes";
}

function joinRemotePath(root: string, relative: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${relative.replace(/^[\\/]+/, "")}`.replace(/\\/g, "/");
}

export function normalizeWebResourceUniqueName(value: string): string {
  return value
    .trim()
    .replace(/^\$webresource:/i, "")
    .replace(/\\/g, "/");
}

function nextCustomActionSequence(view: RibbonView): number {
  const sequences = view.customActions
    .map((action) => action.sequence)
    .filter((sequence): sequence is number => typeof sequence === "number");
  return sequences.length ? Math.max(...sequences) + 10 : 10;
}

function validateUniqueId(
  document: RibbonDocument,
  value: string,
  requiredMessage: string,
  allowedId?: string,
): string | undefined {
  const id = value.trim();
  if (!id) {
    return requiredMessage;
  }

  if (allowedId && id === allowedId) {
    return undefined;
  }

  const used = new Set<string>();
  for (const view of document.views) {
    for (const action of view.customActions) {
      used.add(action.id);
      if (action.commandUI && action.commandUI.kind !== "Unknown") {
        used.add(action.commandUI.id);
      }
    }
    for (const action of view.hideActions) {
      used.add(action.hideActionId);
    }
    for (const command of view.commandDefinitions) {
      used.add(command.id);
    }
    for (const rule of view.enableRules) {
      used.add(rule.id);
    }
    for (const rule of view.displayRules) {
      used.add(rule.id);
    }
    for (const label of view.locLabels) {
      used.add(label.id);
    }
  }

  return used.has(id) ? "This id already exists in this ribbon." : undefined;
}

function collectRibbonIds(document: RibbonDocument): Set<string> {
  const used = new Set<string>();
  for (const view of document.views) {
    for (const action of view.customActions) {
      used.add(action.id);
      if (action.commandUI && action.commandUI.kind !== "Unknown") {
        used.add(action.commandUI.id);
      }
    }
    for (const action of view.hideActions) {
      used.add(action.hideActionId);
    }
    for (const command of view.commandDefinitions) {
      used.add(command.id);
    }
    for (const rule of view.enableRules) {
      used.add(rule.id);
    }
    for (const rule of view.displayRules) {
      used.add(rule.id);
    }
    for (const label of view.locLabels) {
      used.add(label.id);
    }
  }

  return used;
}

function nextBatchId(used: Set<string>, id: string): string {
  if (!used.has(id)) {
    used.add(id);
    return id;
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${id}.${index}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}
