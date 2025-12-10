import * as vscode from "vscode";
import { EnvironmentConfig } from "../types";

export class AuthService {
  async getAccessToken(env: EnvironmentConfig): Promise<string | undefined> {
    const scope = this.buildScope(env);
    try {
      const session = await vscode.authentication.getSession("microsoft", [scope], {
        createIfNone: true,
      });
      return session.accessToken;
    } catch (error) {
      vscode.window.showErrorMessage(
        `Interactive sign-in failed for ${env.name}: ${String(error)}`,
      );
      return undefined;
    }
  }

  private buildScope(env: EnvironmentConfig): string {
    // Use the explicit resource if provided, otherwise default to the org URL.
    const resource = env.resource || env.url;
    // Dynamics requires the /.default scope for AAD.
    return `${resource.replace(/\/$/, "")}/.default`;
  }
}
