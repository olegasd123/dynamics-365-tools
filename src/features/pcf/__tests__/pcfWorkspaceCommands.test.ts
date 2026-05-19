import assert from "node:assert";
import test from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  findGeneratedPcfSourceFile,
  normalizeGeneratedPcfPackageJson,
  normalizeGeneratedPcfTsConfig,
} from "../commands/pcfWorkspaceCommands";

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

test("normalizeGeneratedPcfTsConfig overrides inherited deprecated module resolution", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-command-"));
  const tsConfigPath = path.join(projectRoot, "tsconfig.json");
  await fs.writeFile(
    tsConfigPath,
    JSON.stringify(
      {
        extends: "./node_modules/pcf-scripts/tsconfig_base.json",
        compilerOptions: {
          typeRoots: ["node_modules/@types"],
        },
      },
      null,
      2,
    ),
  );

  try {
    const changed = await normalizeGeneratedPcfTsConfig(projectRoot);
    const tsConfig = JSON.parse(await fs.readFile(tsConfigPath, "utf8"));

    assert.strictEqual(changed, true);
    assert.strictEqual(tsConfig.compilerOptions.moduleResolution, "bundler");
    assert.deepStrictEqual(tsConfig.compilerOptions.types, ["powerapps-component-framework"]);
    assert.deepStrictEqual(tsConfig.compilerOptions.typeRoots, ["node_modules/@types"]);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("normalizeGeneratedPcfTsConfig keeps modern module resolution values", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-command-"));
  const tsConfigPath = path.join(projectRoot, "tsconfig.json");
  await fs.writeFile(
    tsConfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          moduleResolution: "node16",
          types: ["powerapps-component-framework"],
        },
      },
      null,
      2,
    ),
  );

  try {
    const changed = await normalizeGeneratedPcfTsConfig(projectRoot);
    const tsConfig = JSON.parse(await fs.readFile(tsConfigPath, "utf8"));

    assert.strictEqual(changed, false);
    assert.strictEqual(tsConfig.compilerOptions.moduleResolution, "node16");
    assert.deepStrictEqual(tsConfig.compilerOptions.types, ["powerapps-component-framework"]);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("normalizeGeneratedPcfTsConfig keeps existing type package values", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-command-"));
  const tsConfigPath = path.join(projectRoot, "tsconfig.json");
  await fs.writeFile(
    tsConfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          moduleResolution: "bundler",
          types: ["node"],
        },
      },
      null,
      2,
    ),
  );

  try {
    const changed = await normalizeGeneratedPcfTsConfig(projectRoot);
    const tsConfig = JSON.parse(await fs.readFile(tsConfigPath, "utf8"));

    assert.strictEqual(changed, true);
    assert.deepStrictEqual(tsConfig.compilerOptions.types, [
      "node",
      "powerapps-component-framework",
    ]);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("normalizeGeneratedPcfPackageJson adds eslint for pcf-scripts builds", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-command-"));
  const packageJsonPath = path.join(projectRoot, "package.json");
  await fs.writeFile(
    packageJsonPath,
    JSON.stringify(
      {
        name: "pcf-project",
        devDependencies: {
          "pcf-scripts": "^1",
        },
      },
      null,
      2,
    ),
  );

  try {
    const changed = await normalizeGeneratedPcfPackageJson(projectRoot);
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

    assert.strictEqual(changed, true);
    assert.strictEqual(packageJson.devDependencies.ajv, "^8.20.0");
    assert.strictEqual(packageJson.devDependencies.eslint, "^9.34.0");
    assert.strictEqual(packageJson.devDependencies["pcf-scripts"], "^1");
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("normalizeGeneratedPcfPackageJson keeps existing eslint versions", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "d365-pcf-command-"));
  const packageJsonPath = path.join(projectRoot, "package.json");
  await fs.writeFile(
    packageJsonPath,
    JSON.stringify(
      {
        devDependencies: {
          ajv: "^8.19.0",
          eslint: "^8.57.0",
        },
      },
      null,
      2,
    ),
  );

  try {
    const changed = await normalizeGeneratedPcfPackageJson(projectRoot);
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

    assert.strictEqual(changed, false);
    assert.strictEqual(packageJson.devDependencies.ajv, "^8.19.0");
    assert.strictEqual(packageJson.devDependencies.eslint, "^8.57.0");
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
