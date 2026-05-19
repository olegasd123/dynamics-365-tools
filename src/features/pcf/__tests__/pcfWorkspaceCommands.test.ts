import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { findGeneratedPcfSourceFile } from "../commands/pcfWorkspaceCommands";

test("findGeneratedPcfSourceFile finds index.ts in the generated control subfolder", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-command-"));
  const controlRoot = path.join(projectRoot, "CustomEmail");
  await fs.mkdir(controlRoot, { recursive: true });
  await fs.writeFile(
    path.join(controlRoot, "ControlManifest.Input.xml"),
    `
      <manifest>
        <control namespace="Contoso.Controls" constructor="CustomEmail" version="1.0.0">
          <resources>
            <code path="index.ts" order="1" />
          </resources>
        </control>
      </manifest>
    `,
  );
  await fs.writeFile(path.join(controlRoot, "index.ts"), "export class CustomEmail {}\n");

  try {
    const sourceFile = await findGeneratedPcfSourceFile(projectRoot, "CustomEmail");

    assert.strictEqual(sourceFile, path.join(controlRoot, "index.ts"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("findGeneratedPcfSourceFile keeps support for older root index.ts projects", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-command-"));
  await fs.writeFile(path.join(projectRoot, "index.ts"), "export class LinearInput {}\n");

  try {
    const sourceFile = await findGeneratedPcfSourceFile(projectRoot, "LinearInput");

    assert.strictEqual(sourceFile, path.join(projectRoot, "index.ts"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
