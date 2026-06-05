import * as path from "node:path";
import * as vscode from "vscode";
import { CommandContext, RibbonServices } from "../../../app/commandContext";
import { pickDataverseClient } from "../../../app/commandUtils";
import { SolutionImportError } from "../../dataverse/solutionImportService";
import {
  RibbonDocumentNode,
  RibbonExplorerNode,
  RibbonItemNode,
  RibbonSectionNode,
  RibbonSourceNode,
  RibbonViewNode,
} from "../ribbonExplorer";
import { RibbonDocument, RibbonSource } from "../models";
import { createRibbonPullPlan } from "../ribbonPullService";
import type { RibbonPublishSolution } from "../ribbonPublishService";
import { isSolutionExportCancelledError } from "../solutionZipService";
import { showRibbonQuickPick } from "./ribbonPromptUi";

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
const REMOVE_IMPORTED_SOLUTION = "Remove";

export function refreshRibbonExplorer(ctx: CommandContext): void {
  ctx.ribbon.explorer.refresh();
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
    await ctx.core.notifications.warning("Select an imported solution zip source first.");
    return;
  }

  if (ctx.ribbon.editorState.isSourceDirty(source.id)) {
    await ctx.ribbon.editorState.saveSource(source.id);
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

  const savedPath = await ctx.ribbon.solutionZipService.saveSourceToZip(source, target.fsPath);
  ctx.ribbon.explorer.refresh();
  void ctx.core.notifications.info(`Saved solution zip to ${savedPath}.`);
}

export async function openRibbonSolutionLocation(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const source = await resolveSource(ctx, node);
  if (!source) {
    await ctx.core.notifications.warning("Select a ribbon source first.");
    return;
  }

  await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(source.rootUri));
}

export async function removeRibbonSolutionSource(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const source = await resolveSource(ctx, node);
  if (!source || source.kind !== "zip") {
    await ctx.core.notifications.warning("Select an imported solution zip source first.");
    return;
  }

  const choice = await ctx.core.notifications.askWarning(
    `Remove ${source.name} from the explorer?`,
    [REMOVE_IMPORTED_SOLUTION],
    {
      modal: true,
      detail: ctx.ribbon.editorState.isSourceDirty(source.id)
        ? "Unsaved ribbon edits for this solution will be lost. Files on disk will not be deleted."
        : "Files on disk will not be deleted.",
    },
  );
  if (choice !== REMOVE_IMPORTED_SOLUTION) {
    return;
  }

  ctx.ribbon.sourceLocator.removeImportedSource(source.id);
  ctx.ribbon.editorState.removeSource(source.id);
  ctx.ribbon.explorer.refresh();
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
    ? await ctx.ribbon.editorState.saveSource(sourceId)
    : await ctx.ribbon.editorState.saveAllSources();
  ctx.ribbon.explorer.refresh();
  const count = result.changedFileUris.length;
  void ctx.core.notifications.info(
    count ? `Saved ${count} ribbon file${count === 1 ? "" : "s"}.` : "No ribbon changes to save.",
  );
}

export function undoRibbonEdit(ctx: CommandContext): void {
  if (!ctx.ribbon.editorState.undo()) {
    void ctx.core.notifications.warning("No ribbon edit to undo.");
    return;
  }

  ctx.ribbon.explorer.refresh();
}

export function redoRibbonEdit(ctx: CommandContext): void {
  if (!ctx.ribbon.editorState.redo()) {
    void ctx.core.notifications.warning("No ribbon edit to redo.");
    return;
  }

  ctx.ribbon.explorer.refresh();
}

export async function publishRibbonToEnvironment(
  ctx: CommandContext,
  node?: RibbonExplorerNode,
): Promise<void> {
  const sourceId = resolveSourceId(node);
  let documents = await resolvePublishDocuments(ctx, node);
  if (!documents.length) {
    await ctx.core.notifications.warning("Select a ribbon source or ribbon document first.");
    return;
  }

  if (sourceId && ctx.ribbon.editorState.isSourceDirty(sourceId)) {
    const choice = await ctx.core.notifications.askWarning(
      "Save ribbon changes before publishing?",
      ["Save and Publish"],
      { modal: true },
    );
    if (choice !== "Save and Publish") {
      return;
    }
    await ctx.ribbon.editorState.saveSource(sourceId);
    ctx.ribbon.explorer.refresh();
    documents = await resolveSavedPublishDocuments(ctx, node, documents);
    if (!documents.length) {
      await ctx.core.notifications.warning("No saved ribbon documents were found to publish.");
      return;
    }
  }

  const config = await ctx.core.configuration.loadConfiguration();
  const target = await pickDataverseClient(ctx, {
    config,
    placeHolder: "Select environment for ribbon publish",
  });
  if (!target) {
    return;
  }

  const client = target.client;
  const solutions = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading unmanaged solutions",
      cancellable: false,
    },
    () => ctx.ribbon.publishService.listUnmanagedSolutions(client),
  );
  if (!solutions.length) {
    await ctx.core.notifications.warning("No unmanaged solutions were found in this environment.");
    return;
  }

  const solution = await pickRibbonPublishSolution(solutions);
  if (!solution) {
    return;
  }

  let result: Awaited<ReturnType<RibbonServices["publishService"]["publishDocuments"]>> | undefined;
  let publishError: unknown;

  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Publishing ribbons to ${target.env.name}`,
        cancellable: true,
      },
      (progress, token) =>
        ctx.ribbon.publishService.publishDocuments(client, documents, solution, {
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
      const action = await ctx.core.notifications.askError(`Ribbon publish failed: ${message}`, [
        "Copy Error XML",
      ]);
      if (action === "Copy Error XML") {
        await vscode.env.clipboard.writeText(error.log);
      }
      return;
    }

    void ctx.core.notifications.error(`Ribbon publish failed: ${message}`);
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
  void ctx.core.notifications.info(
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

  if (ctx.ribbon.editorState.isSourceDirty(source.id)) {
    await ctx.core.notifications.warning(
      "Save or undo pending ribbon edits before pulling from the environment.",
    );
    return;
  }

  const targetDocuments = await resolvePullDocuments(ctx, source, node);
  if (!targetDocuments.length) {
    await ctx.core.notifications.warning("No local ribbon documents were found to update.");
    return;
  }

  const config = await ctx.core.configuration.loadConfiguration();
  const target = await pickDataverseClient(ctx, {
    config,
    placeHolder: "Select environment to pull ribbons from",
  });
  if (!target) {
    return;
  }

  const client = target.client;
  const solutions = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading unmanaged solutions",
      cancellable: false,
    },
    () => ctx.ribbon.solutionZipService.listUnmanagedSolutions(client),
  );
  const solutionPick = await pickDataverseSolution(solutions, "Select solution to pull ribbons");
  if (!solutionPick) {
    return;
  }

  let buffer: Buffer;
  try {
    buffer = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Exporting ${solutionPick.uniqueName}`,
        cancellable: true,
      },
      (_progress, token) =>
        ctx.ribbon.solutionZipService.downloadSolutionZip(client, solutionPick.uniqueName, token),
    );
  } catch (error) {
    if (isSolutionExportCancelledError(error)) {
      return;
    }
    throw error;
  }
  await offerExportedSolutionBackup(ctx, buffer, solutionPick.uniqueName);
  const incomingSource = await ctx.ribbon.solutionZipService.openZipBuffer(buffer, {
    storageRoot: ctx.extensionContext.globalStorageUri.fsPath,
    sourceName: `${solutionPick.uniqueName}-pull.zip`,
  });
  const incomingDocuments = await ctx.ribbon.repository.loadSource(incomingSource);
  const plan = createRibbonPullPlan(targetDocuments, incomingDocuments);

  if (!plan.matchedDocuments.length) {
    const missing = plan.missingDocuments.length;
    const unchanged = plan.unchangedDocuments.length;
    await ctx.core.notifications.info(
      missing
        ? `No matching ribbon changes were found (${missing} missing, ${unchanged} unchanged).`
        : "Local ribbons already match the environment.",
    );
    return;
  }

  const choice = await ctx.core.notifications.askWarning(
    `Replace ${plan.matchedDocuments.length} local ribbon block${plan.matchedDocuments.length === 1 ? "" : "s"} from ${solutionPick.uniqueName}?`,
    ["Pull"],
    { modal: true },
  );
  if (choice !== "Pull") {
    return;
  }

  const result = await ctx.ribbon.repository.savePatchSequence(plan.patchesByFileUri);
  ctx.ribbon.explorer.refresh();

  void ctx.core.notifications.info(
    `Pulled ${plan.matchedDocuments.length} ribbon block${plan.matchedDocuments.length === 1 ? "" : "s"} into ${result.changedFileUris.length} file${result.changedFileUris.length === 1 ? "" : "s"}.`,
  );
}

export async function cleanupGeneratedRibbonSolutions(ctx: CommandContext): Promise<void> {
  const config = await ctx.core.configuration.loadConfiguration();
  const target = await pickDataverseClient(ctx, {
    config,
    placeHolder: "Select environment for generated solution cleanup",
  });
  if (!target) {
    return;
  }

  const client = target.client;
  const generated = await ctx.ribbon.publishService.listGeneratedSolutions(client);
  if (!generated.length) {
    void ctx.core.notifications.info("No generated ribbon solutions were found.");
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

  const choice = await ctx.core.notifications.askWarning(
    `Delete ${picks.length} generated ribbon solution${picks.length === 1 ? "" : "s"}?`,
    ["Delete"],
    { modal: true },
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
        await ctx.ribbon.publishService.deleteGeneratedSolution(client, pick.solutionId);
      }
    },
  );
  void ctx.core.notifications.info(
    `Deleted ${picks.length} generated ribbon solution${picks.length === 1 ? "" : "s"}.`,
  );
}

export async function openRibbonFile(
  ctx: CommandContext,
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
    await ctx.core.notifications.warning("Select a ribbon document first.");
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

  const source = await ctx.ribbon.solutionZipService.openZipFile(
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

  return ctx.ribbon.editorState.loadSource(source);
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

  const currentDocuments = await ctx.ribbon.editorState.loadSource(source);
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
  const config = await ctx.core.configuration.loadConfiguration();
  const target = await pickDataverseClient(ctx, {
    config,
    placeHolder: "Select environment for solution export",
  });
  if (!target) {
    return;
  }

  const client = target.client;
  const solutions = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading unmanaged solutions",
      cancellable: false,
    },
    () => ctx.ribbon.solutionZipService.listUnmanagedSolutions(client),
  );
  const solutionPick = await pickDataverseSolution(solutions, "Select unmanaged solution");
  if (!solutionPick) {
    return;
  }

  let buffer: Buffer;
  try {
    buffer = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Exporting ${solutionPick.uniqueName}`,
        cancellable: true,
      },
      (_progress, token) =>
        ctx.ribbon.solutionZipService.downloadSolutionZip(client, solutionPick.uniqueName, token),
    );
  } catch (error) {
    if (isSolutionExportCancelledError(error)) {
      return;
    }
    throw error;
  }
  await offerExportedSolutionBackup(ctx, buffer, solutionPick.uniqueName);
  const source = await ctx.ribbon.solutionZipService.openZipBuffer(buffer, {
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

  const sources = await ctx.ribbon.sourceLocator.locate(ctx.core.configuration.workspaceRoot);
  if (!sources.length) {
    await ctx.core.notifications.warning("No local ribbon source was found.");
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

  return ctx.ribbon.editorState.loadSource(source);
}

function pickDataverseSolution(
  solutions: Awaited<ReturnType<RibbonServices["solutionZipService"]["listUnmanagedSolutions"]>>,
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
  ctx.ribbon.sourceLocator.addImportedSource(source);
  ctx.ribbon.explorer.refresh();
  void ctx.core.notifications.info(
    `Opened ${source.name} with ${source.files.length} ribbon file${source.files.length === 1 ? "" : "s"}.`,
  );
}

async function offerExportedSolutionBackup(
  ctx: CommandContext,
  buffer: Buffer,
  solutionUniqueName: string,
): Promise<void> {
  const choice = await ctx.core.notifications.askInfo(
    `Save a backup copy of exported solution ${solutionUniqueName}?`,
    [SAVE_EXPORT_BACKUP, "Skip"],
    { modal: true },
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

  const savedPath = await ctx.ribbon.solutionZipService.saveBufferToZip(buffer, target.fsPath);
  void ctx.core.notifications.info(`Saved solution backup to ${savedPath}.`);
}

function defaultSolutionBackupUri(ctx: CommandContext, solutionUniqueName: string): vscode.Uri {
  const root = ctx.core.configuration.workspaceRoot ?? ctx.extensionContext.globalStorageUri.fsPath;
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

export function resolveSourceId(node: unknown): string | undefined {
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

export async function resolveSource(
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

  const sources = await ctx.ribbon.sourceLocator.locate(ctx.core.configuration.workspaceRoot);
  return sources.find((source) => source.id === sourceId);
}
