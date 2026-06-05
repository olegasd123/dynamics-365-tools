import type * as vscode from "vscode";
import type { SecretStorePort, StateStorePort } from "../../app/ports/storage";

export class VsCodeSecretStore implements SecretStorePort {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    await this.secrets.store(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.secrets.delete(key);
  }
}

export class VsCodeStateStore implements StateStorePort {
  constructor(private readonly state: vscode.Memento) {}

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.state.get<T>(key, defaultValue as T);
  }

  async update(key: string, value: unknown): Promise<void> {
    await this.state.update(key, value);
  }
}
