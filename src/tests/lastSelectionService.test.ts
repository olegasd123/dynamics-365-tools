import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { LastSelectionService } from "../platform/vscode/lastSelectionStore";

class MemoryMemento implements vscode.Memento {
  private map = new Map<string, unknown>();

  keys(): readonly string[] {
    return Array.from(this.map.keys());
  }

  get<T>(key: string): T | undefined {
    return this.map.get(key) as T | undefined;
  }

  async update(key: string, value: any): Promise<void> {
    if (value === undefined) {
      this.map.delete(key);
    } else {
      this.map.set(key, value);
    }
  }
}

test("setLastEnvironment stores value that getLastEnvironment returns", async () => {
  const memento = new MemoryMemento();
  const service = new LastSelectionService(memento);

  await service.setLastEnvironment("dev");

  assert.strictEqual(service.getLastEnvironment(), "dev");
});

test("getLastEnvironment returns undefined when nothing stored", () => {
  const memento = new MemoryMemento();
  const service = new LastSelectionService(memento);

  assert.strictEqual(service.getLastEnvironment(), undefined);
});
