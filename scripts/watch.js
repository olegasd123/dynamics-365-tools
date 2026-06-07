const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const tscBin = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsc.cmd" : "tsc",
);

const children = [
  spawn(process.execPath, ["./esbuild.js", "--watch"], {
    cwd: root,
    stdio: "inherit",
  }),
  spawn(tscBin, ["--noEmit", "--watch", "-p", "./"], {
    cwd: root,
    stdio: "inherit",
  }),
];

let stopping = false;

function stop(code = 0) {
  if (stopping) {
    return;
  }

  stopping = true;
  process.exitCode = code;

  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!stopping && signal !== "SIGTERM") {
      stop(code ?? 1);
    }
  });

  child.on("error", (error) => {
    console.error(error);
    stop(1);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
