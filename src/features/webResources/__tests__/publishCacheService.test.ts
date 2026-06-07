import assert from "node:assert";
import test from "node:test";
import * as path from "path";
import { WorkspaceFileType } from "@app/ports/files";
import type { WorkspaceFileStat } from "@app/ports/files";
import { MemoryWorkspaceFiles } from "../../../testSupport/fakes";
import { PublishCacheService } from "../publishCacheService";
import { ConfigurationService } from "@features/config/configurationService";

test("publish cache tracks unchanged files per environment", async () => {
  const workspaceRoot = path.join("/workspace", "project");
  const files = new MemoryWorkspaceFiles(workspaceRoot);
  const configuration = new ConfigurationService(files);
  const cache = new PublishCacheService(configuration, files);
  const stat: WorkspaceFileStat = {
    type: WorkspaceFileType.File,
    ctime: 0,
    mtime: 123,
    size: 10,
  };

  await cache.update("new_/web/script.js", stat, "hash", "dev");

  const sameEnv = await cache.isUnchanged("new_/web/script.js", stat, "hash", "dev");
  const otherEnv = await cache.isUnchanged("new_/web/script.js", stat, "hash", "test");

  assert.strictEqual(sameEnv, true);
  assert.strictEqual(otherEnv, false);
});
