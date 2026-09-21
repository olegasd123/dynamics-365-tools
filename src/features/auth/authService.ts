import type {
  AuthenticationPort,
  AuthenticationSession,
  AuthenticationSessionOptions,
} from "../../app/ports/authentication";
import { NoopNotificationService, NotificationPort } from "../../app/ports/notifications";
import { EnvironmentConfig } from "../config/domain/models";

export interface InteractiveSignInOptions {
  forceNewSession?: boolean;
  clearSessionPreference?: boolean;
  promptIfNeeded?: boolean;
}

interface CachedAccessToken {
  value: string;
  expiresAt: number;
}

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

export class AuthService {
  private readonly cachedTokens = new Map<string, CachedAccessToken>();
  private readonly automaticSignInAttempts = new Set<string>();
  private readonly automaticSessionRequests = new Map<
    string,
    Promise<AuthenticationSession | undefined>
  >();

  constructor(
    private readonly authentication: AuthenticationPort,
    private readonly notifications: NotificationPort = new NoopNotificationService(),
  ) {}

  async getAccessToken(
    env: EnvironmentConfig,
    options: InteractiveSignInOptions = {},
  ): Promise<string | undefined> {
    const scope = this.buildScope(env);
    try {
      if (!options.forceNewSession && !options.promptIfNeeded) {
        const cachedToken = this.getCachedToken(scope);
        if (cachedToken) {
          return cachedToken;
        }

        const session = await this.getAutomaticSession(scope);
        return this.rememberSession(scope, session);
      }

      this.automaticSignInAttempts.add(scope);
      const sessionOptions: AuthenticationSessionOptions = options.forceNewSession
        ? { forceNewSession: true }
        : { createIfNone: true };
      if (options.clearSessionPreference) {
        sessionOptions.clearSessionPreference = true;
      }
      const session = await this.authentication.getSession("microsoft", [scope], {
        ...sessionOptions,
      });
      return this.rememberSession(scope, session);
    } catch (error) {
      await this.notifications.error(
        `Interactive sign-in failed for ${env.name}: ${String(error)}`,
      );
      return undefined;
    }
  }

  async signOut(env: EnvironmentConfig): Promise<"removed" | "notFound" | "failed"> {
    const scope = this.buildScope(env);
    this.cachedTokens.delete(scope);
    try {
      const session = await this.authentication.getSession("microsoft", [scope], {
        createIfNone: false,
        silent: true,
        clearSessionPreference: true,
      });
      if (!session) {
        return "notFound";
      }

      if (!this.authentication.removeSession) {
        await this.notifications.warning(
          `Sign-out is not supported in this version of VS Code. Remove the Microsoft account from Accounts to sign out.`,
        );
        return "failed";
      }

      await this.authentication.removeSession("microsoft", session.id);
      return "removed";
    } catch (error) {
      await this.notifications.error(`Sign-out failed for ${env.name}: ${String(error)}`);
      return "failed";
    }
  }

  private buildScope(env: EnvironmentConfig): string {
    // Use the explicit resource if provided, otherwise default to the org URL.
    const resource = env.resource || env.url;
    // Dynamics requires the /.default scope for AAD.
    return `${resource.replace(/\/$/, "")}/.default`;
  }

  private async getAutomaticSession(scope: string): Promise<AuthenticationSession | undefined> {
    const pending = this.automaticSessionRequests.get(scope);
    if (pending) {
      return pending;
    }

    const request = this.requestAutomaticSession(scope);
    this.automaticSessionRequests.set(scope, request);
    try {
      return await request;
    } finally {
      this.automaticSessionRequests.delete(scope);
    }
  }

  private async requestAutomaticSession(scope: string): Promise<AuthenticationSession | undefined> {
    const existing = await this.authentication.getSession("microsoft", [scope], {
      createIfNone: false,
      silent: true,
    });
    if (existing || this.automaticSignInAttempts.has(scope)) {
      return existing;
    }

    this.automaticSignInAttempts.add(scope);
    return this.authentication.getSession("microsoft", [scope], {
      createIfNone: true,
    });
  }

  private getCachedToken(scope: string): string | undefined {
    const cached = this.cachedTokens.get(scope);
    if (!cached) {
      return undefined;
    }
    if (cached.expiresAt <= Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
      this.cachedTokens.delete(scope);
      return undefined;
    }
    return cached.value;
  }

  private rememberSession(
    scope: string,
    session: AuthenticationSession | undefined,
  ): string | undefined {
    if (!session) {
      return undefined;
    }

    const expiresAt = this.readTokenExpiry(session.accessToken);
    if (expiresAt) {
      this.cachedTokens.set(scope, { value: session.accessToken, expiresAt });
    }
    return session.accessToken;
  }

  private readTokenExpiry(accessToken: string): number | undefined {
    const payload = accessToken.split(".")[1];
    if (!payload) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        exp?: unknown;
      };
      return typeof parsed.exp === "number" ? parsed.exp * 1000 : undefined;
    } catch {
      return undefined;
    }
  }
}
