const fs = require("node:fs");
const path = require("node:path");

for (const directory of ["dist", "out"]) {
  fs.rmSync(path.join(__dirname, "..", directory), {
    recursive: true,
    force: true,
  });
}
