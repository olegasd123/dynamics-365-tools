import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { WorkspaceFileType } from "../../../app/ports/files";
import type { WorkspaceFileStat } from "../../../app/ports/files";
import { PublishCacheService } from "../publishCacheService";
import { ConfigurationService } from "../../config/configurationService";

test("publish cache tracks unchanged files per environment", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dynamics365-cache-"));
  const configuration = { workspaceRoot } as unknown as ConfigurationService;
  const cache = new PublishCacheService(configuration);
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

  await fs.rm(workspaceRoot, { recursive: true, force: true });
});
