import assert from "node:assert";
import test from "node:test";
import { MemoryStateStore } from "../../../testSupport/fakes";
import { LastSelectionService } from "../lastSelectionStore";

test("setLastEnvironment stores value that getLastEnvironment returns", async () => {
  const memento = new MemoryStateStore();
  const service = new LastSelectionService(memento);

  await service.setLastEnvironment("dev");

  assert.strictEqual(service.getLastEnvironment(), "dev");
});

test("getLastEnvironment returns undefined when nothing stored", () => {
  const memento = new MemoryStateStore();
  const service = new LastSelectionService(memento);

  assert.strictEqual(service.getLastEnvironment(), undefined);
});
