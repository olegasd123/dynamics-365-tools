import assert from "node:assert";
import test from "node:test";
import { SolutionComponentService, SolutionComponentType } from "../solutionComponentService";

class FakeDataverseClient {
  calls: Array<{ method: string; path: string; body?: any }> = [];
  responses = new Map<string, any>();

  addResponse(method: string, path: string, value: any) {
    this.responses.set(`${method} ${path}`, value);
  }

  async get(path: string) {
    this.calls.push({ method: "GET", path });
    return this.responses.get(`GET ${path}`) ?? {};
  }

  async post(path: string, body: any) {
    this.calls.push({ method: "POST", path, body });
    return this.responses.get(`POST ${path}`) ?? {};
  }
}

function solutionPath(name: string): string {
  const filter = encodeURIComponent(`uniquename eq '${name.replace(/'/g, "''")}'`);
  return `/solutions?$select=solutionid,uniquename&$filter=${filter}&$top=1`;
}

function componentFilter(
  componentType: SolutionComponentType,
  componentId: string,
  solutionId: string,
) {
  const filter = encodeURIComponent(
    `componenttype eq ${componentType} and objectid eq ${componentId} and _solutionid_value eq ${solutionId}`,
  );
  return `/solutioncomponents?$select=solutioncomponentid&$filter=${filter}&$top=1`;
}

test("ensureInSolution skips default solution", async () => {
  const client = new FakeDataverseClient();
  const service = new SolutionComponentService(client as any);

  await service.ensureInSolution("comp", SolutionComponentType.PluginType, "Default");

  assert.strictEqual(client.calls.length, 0);
});

test("ensureInSolution throws when solution is missing", async () => {
  const client = new FakeDataverseClient();
  client.addResponse("GET", solutionPath("Core"), { value: [] });
  const service = new SolutionComponentService(client as any);

  await assert.rejects(
    service.ensureInSolution("comp", SolutionComponentType.PluginAssembly, "Core"),
    /Solution Core not found/,
  );
});

test("ensureInSolution avoids adding when component already present", async () => {
  const client = new FakeDataverseClient();
  client.addResponse("GET", solutionPath("Core"), { value: [{ solutionid: "{sol-id}" }] });
  client.addResponse(
    "GET",
    componentFilter(SolutionComponentType.PluginAssembly, "comp", "sol-id"),
    { value: [{ solutioncomponentid: "existing" }] },
  );
  const service = new SolutionComponentService(client as any);

  await service.ensureInSolution("comp", SolutionComponentType.PluginAssembly, "Core");

  const posts = client.calls.filter((c) => c.method === "POST");
  assert.deepStrictEqual(posts, []);
});

test("ensureInSolution adds component when missing", async () => {
  const client = new FakeDataverseClient();
  client.addResponse("GET", solutionPath("Core"), { value: [{ solutionid: "{sol-id}" }] });
  client.addResponse(
    "GET",
    componentFilter(SolutionComponentType.PluginAssembly, "comp", "sol-id"),
    { value: [] },
  );
  const service = new SolutionComponentService(client as any);

  await service.ensureInSolution("comp", SolutionComponentType.PluginAssembly, "Core");

  const post = client.calls.find((c) => c.method === "POST");
  assert.ok(post);
  assert.strictEqual(post?.path, "/AddSolutionComponent");
  assert.deepStrictEqual(post?.body, {
    ComponentId: "comp",
    ComponentType: SolutionComponentType.PluginAssembly,
    SolutionUniqueName: "Core",
    AddRequiredComponents: false,
  });
});

test("listComponentIdsForSolutions aggregates ids across solutions", async () => {
  const client = new FakeDataverseClient();
  client.addResponse("GET", solutionPath("Core"), { value: [{ solutionid: "{sol-1}" }] });
  client.addResponse("GET", solutionPath("Other"), { value: [{ solutionid: "{sol-2}" }] });
  const filter1 = encodeURIComponent(
    `componenttype eq ${SolutionComponentType.PluginStep} and _solutionid_value eq sol-1`,
  );
  const filter2 = encodeURIComponent(
    `componenttype eq ${SolutionComponentType.PluginStep} and _solutionid_value eq sol-2`,
  );
  client.addResponse("GET", `/solutioncomponents?$select=objectid&$filter=${filter1}`, {
    value: [{ objectid: "{id-1}" }],
  });
  client.addResponse("GET", `/solutioncomponents?$select=objectid&$filter=${filter2}`, {
    value: [{ objectid: "id-2" }],
  });

  const service = new SolutionComponentService(client as any);
  const ids = await service.listComponentIdsForSolutions(SolutionComponentType.PluginStep, [
    "Core",
    "Default",
    "Other",
  ]);

  assert.deepStrictEqual(Array.from(ids).sort(), ["id-1", "id-2"]);
});
