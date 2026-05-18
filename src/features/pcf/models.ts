export type PcfControlType = "field" | "dataset" | "virtual";

export type PcfTemplateKind = "ts" | "react" | "unknown";

export interface PcfControlProject {
  rootUri: string;
  manifestUri: string;
  namespace: string;
  constructor: string;
  fullName: string;
  version: string;
  controlType: PcfControlType;
  displayName?: string;
  description?: string;
  templateKind: PcfTemplateKind;
  outputDir: string;
  hasNodeModules: boolean;
  cdsProjectUri?: string;
}

export interface CdsSolutionProject {
  rootUri: string;
  cdsProjectUri: string;
  referencedPcfProjects: string[];
  publisherPrefix?: string;
  solutionUniqueName?: string;
}

export interface DeployedPcfControl {
  customControlId: string;
  name: string;
  version: string;
  managed: boolean;
  solutionUniqueName?: string;
  workspaceMatch?: PcfControlProject;
}

export interface ProcessRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface PacRunResult extends ProcessRunResult {
  parsed?: unknown;
}

export interface ToolDetectionResult {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
}

export interface PcfToolchainStatus {
  pac: ToolDetectionResult;
  node: ToolDetectionResult;
  npm: ToolDetectionResult;
  dotnet: ToolDetectionResult;
}

export type PcfBuildStatusKind = "never" | "running" | "success" | "failed";

export interface PcfBuildStatus {
  kind: PcfBuildStatusKind;
  finishedAt?: number;
  durationMs?: number;
  exitCode?: number;
}

export interface PcfInitOptions {
  namespace: string;
  name: string;
  template: "field" | "dataset";
  framework: "none" | "react";
  runNpmInstall: boolean;
}

export interface PcfPushOptions {
  environmentUrl: string;
  publisherPrefix: string;
}

export interface PacAuthProfile {
  name?: string;
  url?: string;
  user?: string;
}

export interface PacAuthCreateOptions {
  url: string;
  name: string;
}

export interface PcfWorkspaceProjectSettings {
  publisherPrefix?: string;
  lastPackagedZip?: string;
  lastDeployedEnv?: string;
}

export interface PcfWorkspaceSettings {
  projects: Record<string, PcfWorkspaceProjectSettings>;
  watchProjects: string[];
}
