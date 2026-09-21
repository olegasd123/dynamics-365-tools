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
  private readonly promptedSessionRequests = new Map<
    string,
    Promise<AuthenticationSession | undefined>
  >();
  private promptQueue: Promise<void> = Promise.resolve();

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
      if (options.forceNewSession || options.clearSessionPreference) {
        const sessionOptions: AuthenticationSessionOptions = options.forceNewSession
          ? { forceNewSession: true }
          : { createIfNone: true };
        if (options.clearSessionPreference) {
          sessionOptions.clearSessionPreference = true;
        }
        const session = await this.getPromptedSession(scope, sessionOptions, false);
        return this.rememberSession(scope, session);
      }

      const cachedToken = this.getCachedToken(scope);
      if (cachedToken) {
        return cachedToken;
      }

      const existing = await this.authentication.getSession("microsoft", [scope], {
        createIfNone: false,
        silent: true,
      });
      if (existing) {
        return this.rememberSession(scope, existing);
      }
      if (!options.promptIfNeeded) {
        return undefined;
      }

      const session = await this.getPromptedSession(scope, { createIfNone: true }, true);
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

  private async getPromptedSession(
    scope: string,
    options: AuthenticationSessionOptions,
    reusePendingRequest: boolean,
  ): Promise<AuthenticationSession | undefined> {
    const pending = reusePendingRequest ? this.promptedSessionRequests.get(scope) : undefined;
    if (pending) {
      return pending;
    }

    const request = this.enqueuePrompt(scope, options);
    if (!reusePendingRequest) {
      return request;
    }

    this.promptedSessionRequests.set(scope, request);
    try {
      return await request;
    } finally {
      this.promptedSessionRequests.delete(scope);
    }
  }

  private async enqueuePrompt(
    scope: string,
    options: AuthenticationSessionOptions,
  ): Promise<AuthenticationSession | undefined> {
    const previousPrompt = this.promptQueue;
    let finishPrompt: () => void = () => undefined;
    this.promptQueue = new Promise<void>((resolve) => {
      finishPrompt = resolve;
    });

    await previousPrompt;
    try {
      return await this.authentication.getSession("microsoft", [scope], options);
    } finally {
      finishPrompt();
    }
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
