import * as vscode from "vscode";

export interface EnvironmentCredentials {
  clientId: string;
  clientSecret: string;
  tenantId?: string;
}

export class SecretService {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getCredentials(envName: string): Promise<EnvironmentCredentials | undefined> {
    const raw = await this.secrets.get(this.buildKey(envName));
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as EnvironmentCredentials;
    } catch {
      return undefined;
    }
  }

  async setCredentials(envName: string, creds: EnvironmentCredentials): Promise<void> {
    await this.secrets.store(this.buildKey(envName), JSON.stringify(creds));
  }

  async clearCredentials(envName: string): Promise<void> {
    await this.secrets.delete(this.buildKey(envName));
  }

  private buildKey(envName: string): string {
    return `dynamics365tools.env.${envName}.credentials`;
  }
}
