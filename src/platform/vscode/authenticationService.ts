import * as vscode from "vscode";
import type { AuthenticationPort } from "../../app/ports/authentication";

export class VsCodeAuthenticationService implements AuthenticationPort {
  readonly removeSession?: (providerId: string, sessionId: string) => Promise<void>;

  constructor() {
    const authApi = vscode.authentication as typeof vscode.authentication & {
      removeSession?: (providerId: string, sessionId: string) => Thenable<void>;
    };
    if (typeof authApi.removeSession === "function") {
      this.removeSession = async (providerId, sessionId) => {
        await authApi.removeSession?.(providerId, sessionId);
      };
    }
  }

  async getSession(
    providerId: string,
    scopes: readonly string[],
    options: vscode.AuthenticationGetSessionOptions,
  ): Promise<vscode.AuthenticationSession | undefined> {
    return vscode.authentication.getSession(providerId, [...scopes], options);
  }
}
