export interface AuthenticationSession {
  id: string;
  accessToken: string;
}

export interface AuthenticationSessionOptions {
  createIfNone?: boolean;
  forceNewSession?: boolean;
  silent?: boolean;
  clearSessionPreference?: boolean;
}

export interface AuthenticationPort {
  getSession(
    providerId: string,
    scopes: readonly string[],
    options: AuthenticationSessionOptions,
  ): Promise<AuthenticationSession | undefined>;
  removeSession?(providerId: string, sessionId: string): Promise<void>;
}
