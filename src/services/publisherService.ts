import * as vscode from "vscode";
import { BindingEntry, EnvironmentConfig } from "../types";
import { EnvironmentCredentials } from "./secretService";

export interface PublishAuth {
  accessToken?: string;
  credentials?: EnvironmentCredentials;
}

export class PublisherService {
  private readonly output: vscode.OutputChannel;

  constructor() {
    this.output = vscode.window.createOutputChannel("XRM Publisher");
  }

  async publish(
    binding: BindingEntry,
    env: EnvironmentConfig,
    auth: PublishAuth = {},
  ): Promise<void> {
    this.output.appendLine(
      `[${new Date().toISOString()}] Publishing ${binding.remotePath} to ${env.name} (${env.url})...`,
    );
    if (auth.accessToken) {
      this.output.appendLine("Using interactive access token from VS Code authentication provider.");
    } else if (auth.credentials) {
      this.output.appendLine(
        `Using clientId ${auth.credentials.clientId} ${
          auth.credentials.tenantId ? `(tenant ${auth.credentials.tenantId})` : ""
        } from secret storage.`,
      );
    } else {
      this.output.appendLine("No credentials found. Sign in or set credentials first.");
    }
    // Placeholder for CRM publish logic.
    await new Promise((resolve) => setTimeout(resolve, 300));
    this.output.appendLine("Upload completed (stub).");
    this.output.appendLine("Publishing to CRM (stub)...");
    await new Promise((resolve) => setTimeout(resolve, 200));
    this.output.appendLine("Publish completed.");
    this.output.show(true);
  }
}
