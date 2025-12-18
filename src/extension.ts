import * as vscode from "vscode";
import { createServices } from "./app/createServices";
import { registerCommands } from "./app/registerCommands";

export async function activate(context: vscode.ExtensionContext) {
  const services = await createServices(context);
  context.subscriptions.push(...registerCommands(services));
}

export function deactivate() {}
