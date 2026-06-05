export interface SecretStorePort {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface StateStorePort {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Promise<void>;
}
