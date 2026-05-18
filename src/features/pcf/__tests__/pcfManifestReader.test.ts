import assert from "node:assert";
import test from "node:test";
import { PcfManifestReader } from "../pcfManifestReader";

test("reads core PCF manifest attributes", () => {
  const reader = new PcfManifestReader();

  const manifest = reader.read(`
    <manifest>
      <control namespace="Contoso.Controls" constructor="LinearInput" version="1.2.3" display-name-key="Linear Input" description-key="Demo control">
        <property name="value" display-name-key="Value" of-type="SingleLine.Text" usage="bound" required="true" />
      </control>
    </manifest>
  `);

  assert.deepStrictEqual(manifest, {
    namespace: "Contoso.Controls",
    constructor: "LinearInput",
    version: "1.2.3",
    controlType: "field",
    displayName: "Linear Input",
    description: "Demo control",
  });
});

test("detects dataset controls", () => {
  const reader = new PcfManifestReader();

  const manifest = reader.read(`
    <manifest>
      <control namespace="Contoso" constructor="Grid" version="1.0.0">
        <data-set name="items" display-name-key="Items" />
      </control>
    </manifest>
  `);

  assert.strictEqual(manifest.controlType, "dataset");
});

test("fails when required control attributes are missing", () => {
  const reader = new PcfManifestReader();

  assert.throws(
    () =>
      reader.read(`
        <manifest>
          <control namespace="Contoso" constructor="Broken" />
        </manifest>
      `),
    /missing version/,
  );
});
