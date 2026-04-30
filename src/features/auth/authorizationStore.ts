import type * as vscode from "vscode";
import { NormalizedEnvironmentConfig } from "../config/domain/models";

export interface AuthorizationProfile {
  name: string;
  url: string;
  resource?: string;
  authType?: "interactive" | "clientSecret";
}

const AUTHORIZATIONS_KEY = "dynamics365tools.authorizations";

export class AuthorizationStore {
  constructor(private readonly globalState: vscode.Memento) {}

  list(): AuthorizationProfile[] {
    const saved = this.globalState.get<AuthorizationProfile[]>(AUTHORIZATIONS_KEY, []);
    return saved
      .filter((item) => item.name?.trim() && item.url?.trim())
      .map((item) => ({
        name: item.name.trim(),
        url: this.trimUrl(item.url),
        resource: item.resource?.trim() || undefined,
        authType: item.authType,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async save(profile: AuthorizationProfile): Promise<void> {
    const existing = this.list();
    const normalizedUrl = this.normalizeUrl(profile.url);
    const next: AuthorizationProfile = {
      name: profile.name.trim(),
      url: this.trimUrl(profile.url),
      resource: profile.resource?.trim() || undefined,
      authType: profile.authType,
    };

    const index = existing.findIndex(
      (item) =>
        this.normalizeUrl(item.url) === normalizedUrl ||
        item.name.toLowerCase() === next.name.toLowerCase(),
    );
    if (index >= 0) {
      existing[index] = next;
    } else {
      existing.push(next);
    }

    await this.globalState.update(AUTHORIZATIONS_KEY, existing);
  }

  toEnvironment(
    profile: AuthorizationProfile,
    fallbackAuthType: "interactive" | "clientSecret",
  ): NormalizedEnvironmentConfig {
    return {
      name: profile.name,
      url: profile.url,
      resource: profile.resource,
      authType: profile.authType ?? fallbackAuthType,
      manageMissingComponents: false,
      userAgentEnabled: false,
    };
  }

  private trimUrl(url: string): string {
    return url.trim().replace(/\/+$/, "");
  }

  private normalizeUrl(url: string): string {
    return this.trimUrl(url).toLowerCase();
  }
}
