import * as path from "node:path";
import * as vscode from "vscode";
import { createServices } from "./app/createServices";
import { registerCommands } from "./app/registerCommands";
import { cleanRibbonZipsFolder } from "./features/ribbons/solutionZipService";

const RIBBON_ZIPS_KEEP = 5;

let ribbonZipsPath: string | undefined;

export async function activate(context: vscode.ExtensionContext) {
  ribbonZipsPath = path.join(context.globalStorageUri.fsPath, "ribbon-zips");
  const services = await createServices(context);
  context.subscriptions.push(...registerCommands(services));
}

export async function deactivate() {
  if (ribbonZipsPath) {
    await cleanRibbonZipsFolder(ribbonZipsPath, RIBBON_ZIPS_KEEP).catch(() => {
      // Ignore errors so shutdown is never blocked
    });
  }
}
