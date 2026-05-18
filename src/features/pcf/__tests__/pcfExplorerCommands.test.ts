import assert from "node:assert";
import test from "node:test";
import { updateControlVersionInManifest } from "../commands/pcfExplorerCommands";

test("updateControlVersionInManifest replaces the control version", () => {
  const updated = updateControlVersionInManifest(
    `<manifest><control namespace="Contoso" constructor="LinearInput" version="1.0.0" /></manifest>`,
    "1.2.3",
  );

  assert.match(updated, /version="1\.2\.3"/);
  assert.doesNotMatch(updated, /version="1\.0\.0"/);
});

test("updateControlVersionInManifest adds a missing control version", () => {
  const updated = updateControlVersionInManifest(
    `<manifest><control namespace="Contoso" constructor="LinearInput"></control></manifest>`,
    "2.0.0",
  );

  assert.match(
    updated,
    /<control namespace="Contoso" constructor="LinearInput" version="2\.0\.0">/,
  );
});
