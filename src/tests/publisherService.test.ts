import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { PublisherService } from "../services/publisherService";

test("resolvePaths maps folder bindings to nested files", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xrm-publish-"));
  (vscode.workspace as any).workspaceFolders = [
    { uri: vscode.Uri.file(workspaceRoot) },
  ];
  const folder = path.join(workspaceRoot, "web");
  const file = path.join(folder, "script.js");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(file, "console.log('hi');");

  const publisher = new PublisherService();
  const paths = await (publisher as any).resolvePaths(
    {
      relativeLocalPath: folder,
      remotePath: "new_/web",
      solutionName: "CoreWebResources",
      kind: "folder",
    },
    vscode.Uri.file(file),
  );

  assert.strictEqual(paths.localPath, file);
  assert.strictEqual(paths.remotePath, "new_/web/script.js");
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("resolvePaths rejects publishing a directory target", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xrm-publish-"));
  (vscode.workspace as any).workspaceFolders = [
    { uri: vscode.Uri.file(workspaceRoot) },
  ];
  const folder = path.join(workspaceRoot, "web");
  await fs.mkdir(folder, { recursive: true });

  const publisher = new PublisherService();
  await assert.rejects(
    (publisher as any).resolvePaths(
      {
        relativeLocalPath: folder,
        remotePath: "new_/web",
        solutionName: "CoreWebResources",
        kind: "folder",
      },
      vscode.Uri.file(folder),
    ),
    /Select a file inside the bound folder to publish/,
  );

  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test("detectType maps known extensions to correct codes", () => {
  const publisher = new PublisherService();
  assert.strictEqual((publisher as any).detectType("file.css"), 2);
  assert.strictEqual((publisher as any).detectType("file.js"), 3);
  assert.strictEqual((publisher as any).detectType("file.xml"), 4);
  assert.strictEqual((publisher as any).detectType("file.png"), 5);
  assert.strictEqual((publisher as any).detectType("file.svg"), 12);
});

test("resolveToken uses interactive token when provided", async () => {
  const publisher = new PublisherService();
  const token = await (publisher as any).resolveToken(
    { name: "dev", url: "https://example" },
    { accessToken: "interactive-token" },
    true,
  );

  assert.strictEqual(token, "interactive-token");
  const logs = (publisher as any).output.logs;
  assert.ok(logs.some((line: string) => line.includes("Using interactive access token")));
});

test("resolveToken falls back to client credentials when interactive token missing", async () => {
  const publisher = new PublisherService();
  (publisher as any).acquireTokenWithClientCredentials = async () => "client-token";

  const token = await (publisher as any).resolveToken(
    { name: "dev", url: "https://example" },
    {
      credentials: {
        clientId: "id",
        clientSecret: "secret",
      },
    },
    true,
  );

  assert.strictEqual(token, "client-token");
  const logs = (publisher as any).output.logs;
  assert.ok(
    logs.some((line: string) => line.includes("Using clientId id")),
  );
});
