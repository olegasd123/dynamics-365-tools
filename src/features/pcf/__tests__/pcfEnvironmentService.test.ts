import assert from "node:assert";
import test from "node:test";
import * as path from "path";
import { SolutionComponentType } from "../../dataverse/solutionComponentService";
import { PcfControlProject } from "../models";
import { listDeployedPcfControls } from "../pcfEnvironmentService";

class FakeClient {
  calls: string[] = [];

  constructor(private readonly response: unknown) {}

  async get<T>(path: string): Promise<T> {
    this.calls.push(path);
    return this.response as T;
  }
}

class FakeSolutionComponents {
  calls: Array<{ componentType: SolutionComponentType; solutionNames: string[] }> = [];

  constructor(private readonly ids: string[]) {}

  async listComponentIdsForSolutions(
    componentType: SolutionComponentType,
    solutionNames: string[],
  ): Promise<Set<string>> {
    this.calls.push({ componentType, solutionNames });
    return new Set(this.ids);
  }
}

test("listDeployedPcfControls maps customcontrols and matches workspace projects", async () => {
  const client = new FakeClient({
    value: [
      {
        customcontrolid: "{control-1}",
        name: "Contoso.LinearInput",
        version: "1.0.0",
        ismanaged: false,
      },
      {
        customcontrolid: "{control-2}",
        name: "Other.Grid",
        version: "2.0.0",
        ismanaged: true,
      },
    ],
  });
  const solutionComponents = new FakeSolutionComponents([]);

  const controls = await listDeployedPcfControls(client, solutionComponents, {
    workspaceProjects: [createProject("/tmp/control")],
  });

  assert.deepStrictEqual(client.calls, [
    "/customcontrols?$select=customcontrolid,name,version,ismanaged&$orderby=name",
  ]);
  assert.strictEqual(controls.length, 2);
  assert.strictEqual(controls[0].customControlId, "control-1");
  assert.strictEqual(controls[0].workspaceMatch?.fullName, "Contoso.LinearInput");
  assert.strictEqual(controls[1].managed, true);
});

test("listDeployedPcfControls filters by configured solutions", async () => {
  const client = new FakeClient({
    value: [
      { customcontrolid: "{control-1}", name: "Contoso.LinearInput" },
      { customcontrolid: "{control-2}", name: "Other.Grid" },
    ],
  });
  const solutionComponents = new FakeSolutionComponents(["control-2"]);

  const controls = await listDeployedPcfControls(client, solutionComponents, {
    solutionNames: ["Core"],
  });

  assert.deepStrictEqual(solutionComponents.calls, [
    {
      componentType: SolutionComponentType.CustomControl,
      solutionNames: ["Core"],
    },
  ]);
  assert.deepStrictEqual(
    controls.map((control) => control.name),
    ["Other.Grid"],
  );
});

function createProject(rootUri: string): PcfControlProject {
  return {
    rootUri,
    manifestUri: path.join(rootUri, "ControlManifest.Input.xml"),
    namespace: "Contoso",
    constructor: "LinearInput",
    fullName: "Contoso.LinearInput",
    version: "1.0.0",
    controlType: "field",
    templateKind: "ts",
    outputDir: path.join(rootUri, "out", "controls", "LinearInput"),
    hasNodeModules: true,
  };
}
