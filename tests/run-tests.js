const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const outDir = path.join(__dirname, "..", "out");
if (!fs.existsSync(outDir)) {
  console.error(`Compiled output directory not found: ${outDir}`);
  process.exit(1);
}

const hasTestsSegment = (filePath) => filePath.split(path.sep).includes("__tests__");
const collectTests = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTests(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".test.js") &&
      hasTestsSegment(fullPath)
    ) {
      files.push(fullPath);
    }
  }

  return files;
};

const testFiles = collectTests(outDir);
if (!testFiles.length) {
  console.error(`No compiled tests found under ${outDir}`);
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ["--require", path.join(__dirname, "shims/register.js"), "--test", ...testFiles],
  { stdio: "inherit", env: process.env }
);

child.on("close", (code) => {
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
