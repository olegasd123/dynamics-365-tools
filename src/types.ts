export interface EnvironmentConfig {
  name: string;
  url: string;
  /** Optional resource/audience to request tokens for; defaults to url */
  resource?: string;
  /** Preferred auth type; defaults to interactive */
  authType?: "interactive" | "clientSecret";
}

export interface SolutionConfig {
  /** Unique solution name (CRM solution unique name) */
  name: string;
  /** Publisher prefix used for web resource paths, e.g. new_ */
  prefix: string;
  displayName?: string;
  default?: boolean;
}

export interface XrmConfiguration {
  environments: EnvironmentConfig[];
  solutions: SolutionConfig[];
  /** Default solution name (unique name) */
  defaultSolution?: string;
}

export interface BindingEntry {
  /** Absolute path to the bound resource */
  localPath: string;
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
