export interface EnvironmentConfig {
  name: string;
  url: string;
  /** Optional resource/audience to request tokens for; defaults to url */
  resource?: string;
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
  default?: boolean;
}

export interface XrmConfiguration {
  environments: EnvironmentConfig[];
  solutions: SolutionConfig[];
  /** Default solution name (unique name) */
  defaultSolution?: string;
  /** Supported web resource file extensions (lowercase, dot-prefixed) */
  webResourceSupportedExtensions?: string[];
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
