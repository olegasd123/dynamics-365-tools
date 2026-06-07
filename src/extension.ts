import * as path from "node:path";
import * as vscode from "vscode";
import { createServices } from "./app/createServices";
import { registerCommands } from "./app/registerCommands";
import { cleanRibbonZipsFolder } from "./features/ribbons/solutionZipService";

const RIBBON_ZIPS_KEEP = 5;
const RIBBON_ZIPS_CLEAN_DELAY_MS = 30_000;

export async function activate(context: vscode.ExtensionContext) {
  const ribbonZipsPath = path.join(context.globalStorageUri.fsPath, "ribbon-zips");

  const timer = setTimeout(() => {
    cleanRibbonZipsFolder(ribbonZipsPath, RIBBON_ZIPS_KEEP).catch(() => {});
  }, RIBBON_ZIPS_CLEAN_DELAY_MS);

  context.subscriptions.push({ dispose: () => clearTimeout(timer) });

  const services = createServices(context);
  context.subscriptions.push(services, ...registerCommands(services));
}

export function deactivate() {}
