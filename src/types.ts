export { DEFAULT_SOLUTION_NAME } from "./features/config/constants";

export type {
  BindingEntry,
  BindingSnapshot,
  Dynamics365Configuration,
  EnvironmentConfig,
  NormalizedEnvironmentConfig,
  PublishCache,
  PublishCacheEntry,
  SolutionConfig,
} from "./features/config/schema";

export interface PublishContext {
  credentialsMissing: boolean;
}

// Use for any secret values that might flow into telemetry to ensure masking.
export type MaskedString = string & { __masked: true };
