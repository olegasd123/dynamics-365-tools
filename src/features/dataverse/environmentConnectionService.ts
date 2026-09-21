import { NoopNotificationService, NotificationPort } from "@app/ports/notifications";
import { EnvironmentConfig } from "../config/domain/models";
import { AuthService } from "../auth/authService";
import { EnvironmentCredentials, SecretService } from "../auth/secretService";
import { DataverseClient } from "./dataverseClient";

export interface EnvironmentConnection {
  env: EnvironmentConfig;
  apiRoot: string;
  token: string;
  userAgent?: string;
}

export interface EnvironmentAuthContext {
  accessToken?: string;
  credentials?: EnvironmentCredentials;
}

export class EnvironmentConnectionService {
  constructor(
    private readonly auth: AuthService,
    private readonly secrets: SecretService,
    private readonly notifications: NotificationPort = new NoopNotificationService(),
    private readonly defaultUserAgent = "Dynamics365Tools-VSCode/dev",
  ) {}

  async createConnection(
    env: EnvironmentConfig,
    authContext: EnvironmentAuthContext = {},
  ): Promise<EnvironmentConnection | undefined> {
    const userAgent = this.buildUserAgent(env);
    let token = await this.resolveToken(env, authContext, userAgent);
    if (!token) {
      if (env.authType !== "clientSecret") {
        const action = await this.notifications.askError(
          `No credentials available for ${env.name}. Sign in to this environment to continue.`,
          ["Sign In"],
        );
        if (action === "Sign In") {
          token = await this.auth.getAccessToken(env, { promptIfNeeded: true });
        }
      } else {
        await this.notifications.error(
          `No client credentials available for ${env.name}. Set client credentials first.`,
        );
      }
    }
    if (!token) {
      return undefined;
    }

    return {
      env,
      apiRoot: this.apiRoot(env.url),
      token,
      userAgent,
    };
  }

  async createClient(
    env: EnvironmentConfig,
    authContext: EnvironmentAuthContext = {},
  ): Promise<DataverseClient | undefined> {
    const connection = await this.createConnection(env, authContext);
    return connection ? new DataverseClient(connection) : undefined;
  }

  private async resolveToken(
    env: EnvironmentConfig,
    authContext: EnvironmentAuthContext,
    userAgent?: string,
  ): Promise<string | undefined> {
    if (authContext.accessToken) {
      return authContext.accessToken;
    }

    if (authContext.credentials) {
      return this.acquireTokenWithClientCredentials(env, authContext.credentials, userAgent);
    }

    if (env.authType === "clientSecret") {
      const stored = await this.secrets.getCredentials(env.name);
      if (stored) {
        return this.acquireTokenWithClientCredentials(env, stored, userAgent);
      }
    }

    const interactive = await this.auth.getAccessToken(env);
    if (interactive) {
      return interactive;
    }

    const stored = await this.secrets.getCredentials(env.name);
    if (stored) {
      return this.acquireTokenWithClientCredentials(env, stored, userAgent);
    }

    return undefined;
  }

  private apiRoot(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/+$/, "");
    return `${trimmed}/api/data/v9.2`;
  }

  private buildUserAgent(env: EnvironmentConfig): string | undefined {
    if (!env.userAgentEnabled) {
      return undefined;
    }
    if (env.userAgent?.trim()) {
      return env.userAgent.trim();
    }
    return this.defaultUserAgent;
  }

  private async acquireTokenWithClientCredentials(
    env: EnvironmentConfig,
    credentials: EnvironmentCredentials,
    userAgent?: string,
  ): Promise<string> {
    const tenantId = credentials.tenantId || "organizations";
    const resource = (env.resource || env.url).replace(/\/$/, "");
    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.withUserAgent(
        {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        userAgent,
      ),
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        scope: `${resource}/.default`,
        grant_type: "client_credentials",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      const message = body || response.statusText;
      throw new Error(
        `Failed to acquire client credentials token: ${message} (${response.status})`,
      );
    }

    const parsed = (await response.json()) as { access_token?: string };
    if (!parsed.access_token) {
      throw new Error("Token endpoint returned no access token.");
    }

    return parsed.access_token;
  }

  private withUserAgent<T extends Record<string, string>>(
    headers: T,
    userAgent?: string,
  ): T & { "User-Agent"?: string } {
    if (!userAgent) {
      return headers;
    }
    return { ...headers, "User-Agent": userAgent };
  }
}
