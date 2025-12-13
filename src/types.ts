export interface EnvironmentConfig {
  name: string;
  url: string;
  /** Optional resource/audience to request tokens for; defaults to url */
  resource?: string;
  /** Optional user agent to send with HTTP requests */
  userAgent?: string;
  /** Opt-in flag to include user agent in HTTP requests */
  userAgentEnabled?: boolean;
  /** Preferred auth type; defaults to interactive */
  authType?: "interactive" | "clientSecret";
  /** If false, publishing will fail instead of creating missing web resources */
  createMissingWebResources?: boolean;
}

export interface SolutionConfig {
  /** Unique solution name (CRM solution unique name) */
  name: string;
  /** Publisher prefix used for web resource paths, e.g. new_ */
  prefix: string;
}

/** Built-in solution unique name used by Dynamics 365 */
export const DEFAULT_SOLUTION_NAME = "Default";

export interface Dynamics365Configuration {
  environments: EnvironmentConfig[];
  solutions: SolutionConfig[];
  /** Supported web resource file extensions (lowercase, dot-prefixed) */
}

export interface BindingEntry {
  /** Absolute path to the bound resource */
  relativeLocalPath: string;
  /** CRM web resource path, e.g. new_/account/form.js */
  remotePath: string;
  /** Solution unique name */
  solutionName: string;
  /** folder or file binding */
  kind: "file" | "folder";
}

export interface BindingSnapshot {
  bindings: BindingEntry[];
}

export interface PublishContext {
  credentialsMissing: boolean;
}

// Use for any secret values that might flow into telemetry to ensure masking.
export type MaskedString = string & { __masked: true };
