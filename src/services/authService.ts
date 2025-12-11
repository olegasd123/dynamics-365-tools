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

  async signOut(env: EnvironmentConfig): Promise<"removed" | "notFound" | "failed"> {
    const scope = this.buildScope(env);
    try {
      const session = await vscode.authentication.getSession("microsoft", [scope], {
        createIfNone: false,
        silent: true,
        clearSessionPreference: true,
      });
      if (!session) {
        return "notFound";
      }

      const authApi = vscode.authentication as any;
      if (typeof authApi.removeSession !== "function") {
        vscode.window.showWarningMessage(
          `Sign-out is not supported in this version of VS Code. Remove the Microsoft account from Accounts to sign out.`,
        );
        return "failed";
      }

      await authApi.removeSession("microsoft", session.id);
      return "removed";
    } catch (error) {
      vscode.window.showErrorMessage(`Sign-out failed for ${env.name}: ${String(error)}`);
      return "failed";
    }
  }

  private buildScope(env: EnvironmentConfig): string {
    // Use the explicit resource if provided, otherwise default to the org URL.
    const resource = env.resource || env.url;
    // Dynamics requires the /.default scope for AAD.
    return `${resource.replace(/\/$/, "")}/.default`;
  }
}
