const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const buildLabel = watch ? "watch" : "build";

/** @type {import("esbuild").Plugin} */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log(`[${buildLabel}] build started`);
    });

    build.onEnd((result) => {
      for (const error of result.errors) {
        console.error(`✘ [ERROR] ${error.text}`);
        if (error.location) {
          console.error(
            `    ${error.location.file}:${error.location.line}:${error.location.column}:`,
          );
        }
      }

      console.log(`[${buildLabel}] build finished`);
    });
  },
};

/** @type {import("esbuild").BuildOptions} */
const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  minify: production,
  platform: "node",
  sourcemap: production ? false : "linked",
  sourcesContent: false,
  outfile: "dist/extension.js",
  external: ["vscode"],
  logLevel: "warning",
  plugins: [esbuildProblemMatcherPlugin],
};

async function main() {
  const context = await esbuild.context(buildOptions);

  if (watch) {
    await context.watch();
  } else {
    await context.rebuild();
    await context.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
