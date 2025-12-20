import assert from "node:assert";
import test from "node:test";
import { SolutionComponentType } from "../../dataverse/solutionComponentService";
import { PluginService } from "../pluginService";

class FakeDataverseClient {
  calls: Array<{ method: string; path: string; body?: any }> = [];
  responses = new Map<string, any>();

  addResponse(method: string, path: string, value: any) {
    this.responses.set(`${method} ${path}`, value);
  }

  async get(path: string) {
    this.calls.push({ method: "GET", path });
    return this.resolve("GET", path);
  }

  async post(path: string, body?: any) {
    this.calls.push({ method: "POST", path, body });
    return this.resolve("POST", path);
  }

  async patch(path: string, body: any) {
    this.calls.push({ method: "PATCH", path, body });
    return this.resolve("PATCH", path);
  }

  async delete(path: string) {
    this.calls.push({ method: "DELETE", path });
    return this.resolve("DELETE", path);
  }

  private resolve(method: string, path: string) {
    return this.responses.get(`${method} ${path}`) ?? {};
  }
}

class FakeSolutionComponents {
  calls: Array<{ id: string; type: SolutionComponentType; solution: string }> = [];
  componentIds = new Set<string>();

  async ensureInSolution(id: string, type: SolutionComponentType, solution: string) {
    this.calls.push({ id, type, solution });
  }

  async listComponentIdsForSolutions() {
    return this.componentIds;
  }
}

test("registerAssembly adds created assembly to solution", async () => {
  const client = new FakeDataverseClient();
  const components = new FakeSolutionComponents();
  client.addResponse("POST", "/pluginassemblies", { pluginassemblyid: "{abc}" });

  const service = new PluginService(client as any, components as any);
  const id = await service.registerAssembly({
    name: "Sample",
    contentBase64: "content",
    solutionName: "Core",
  });

  assert.strictEqual(id, "{abc}");
  assert.deepStrictEqual(components.calls, [
    { id: "{abc}", type: SolutionComponentType.PluginAssembly, solution: "Core" },
  ]);
});

test("registerAssembly falls back to findAssemblyByName when Dataverse omits id", async () => {
  const client = new FakeDataverseClient();
  const components = new FakeSolutionComponents();
  client.addResponse("POST", "/pluginassemblies", {});

  class TestService extends PluginService {
    async findAssemblyByName() {
      return { id: "found-id", name: "Sample" } as any;
    }
  }

  const service = new TestService(client as any, components as any);
  const id = await service.registerAssembly({
    name: "Sample",
    contentBase64: "content",
    solutionName: "Core",
  });

  assert.strictEqual(id, "found-id");
  assert.strictEqual(components.calls[0].id, "found-id");
});

test("createStep binds message and filter and adds to solution", async () => {
  const client = new FakeDataverseClient();
  const components = new FakeSolutionComponents();
  client.addResponse("POST", "/sdkmessageprocessingsteps", { sdkmessageprocessingstepid: "step1" });

  const service = new PluginService(client as any, components as any);
  (service as any).resolveSdkMessageId = async () => "msg-id";
  (service as any).resolveSdkMessageFilterId = async () => "filter-id";
  const stepId = await service.createStep("plugin-type", {
    name: "On Create",
    messageName: "Create",
    primaryEntity: "account",
    stage: 20,
    mode: 1,
    rank: 2,
    filteringAttributes: "name,address",
    description: "desc",
    solutionName: "Core",
  });

  assert.strictEqual(stepId, "step1");
  const call = client.calls.find((c) => c.method === "POST");
  assert.ok(call);
  assert.strictEqual(call?.path, "/sdkmessageprocessingsteps");
  assert.deepStrictEqual(call?.body, {
    name: "On Create",
    stage: 20,
    mode: 1,
    rank: 2,
    filteringattributes: "name,address",
    description: "desc",
    supporteddeployment: 0,
    invocationsource: 0,
    "eventhandler_plugintype@odata.bind": "/plugintypes(plugin-type)",
    "sdkmessageid@odata.bind": "/sdkmessages(msg-id)",
    "sdkmessagefilterid@odata.bind": "/sdkmessagefilters(filter-id)",
  });
  assert.deepStrictEqual(components.calls, [
    { id: "step1", type: SolutionComponentType.PluginStep, solution: "Core" },
  ]);
});

test("updateStep sets message and filter when primary entity provided", async () => {
  const client = new FakeDataverseClient();
  const components = new FakeSolutionComponents();

  const service = new PluginService(client as any, components as any);
  (service as any).resolveSdkMessageId = async () => "11111111-1111-1111-1111-111111111111";
  (service as any).resolveSdkMessageFilterId = async () => "22222222-2222-2222-2222-222222222222";
  (service as any).getStepMessageId = async () => "current-msg";
  await service.updateStep("{step-id}", {
    name: "Updated",
    stage: 40,
    mode: 0,
    rank: 1,
    filteringAttributes: "fullname",
    description: "updated",
    messageName: "Update",
    primaryEntity: "contact",
    status: 1,
    statusReason: 2,
  });

  const call = client.calls.find((c) => c.method === "PATCH");
  assert.ok(call);
  assert.strictEqual(call?.path, "/sdkmessageprocessingsteps(step-id)");
  assert.deepStrictEqual(call?.body, {
    name: "Updated",
    stage: 40,
    mode: 0,
    rank: 1,
    filteringattributes: "fullname",
    description: "updated",
    statecode: 1,
    statuscode: 2,
    "sdkmessageid@odata.bind": "/sdkmessages(11111111-1111-1111-1111-111111111111)",
    "sdkmessagefilterid@odata.bind": "/sdkmessagefilters(22222222-2222-2222-2222-222222222222)",
  });
});

test("createImage applies default message property name when missing", async () => {
  const client = new FakeDataverseClient();
  client.addResponse("POST", "/sdkmessageprocessingstepimages", {
    sdkmessageprocessingstepimageid: "image1",
  });

  const service = new PluginService(client as any, new FakeSolutionComponents() as any);
  const id = await service.createImage("step1", {
    name: "PreImage",
    type: 0,
    entityAlias: "pre",
  });

  assert.strictEqual(id, "image1");
  const call = client.calls.find((c) => c.method === "POST");
  assert.ok(call);
  assert.deepStrictEqual(call?.body, {
    name: "PreImage",
    imagetype: 0,
    entityalias: "pre",
    attributes: "",
    messagepropertyname: "Target",
    "sdkmessageprocessingstepid@odata.bind": "/sdkmessageprocessingsteps(step1)",
  });
});

test("deleteStep removes images before deleting the step", async () => {
  const client = new FakeDataverseClient();
  const components = new FakeSolutionComponents();

  class TestService extends PluginService {
    lookups: string[] = [];
    async listImages(stepId: string) {
      this.lookups.push(stepId);
      return [{ id: "img1", name: "one" } as any, { id: "{img2}", name: "two" } as any];
    }
  }

  const service = new TestService(client as any, components as any);
  await service.deleteStep("{step-id}");

  assert.deepStrictEqual((service as any).lookups, ["step-id"]);
  const deletePaths = client.calls.filter((c) => c.method === "DELETE").map((c) => c.path);
  assert.deepStrictEqual(deletePaths, [
    "/sdkmessageprocessingstepimages(img1)",
    "/sdkmessageprocessingstepimages(img2)",
    "/sdkmessageprocessingsteps(step-id)",
  ]);
});

test("deletePluginTypeCascade delegates deletions to deleteStep for every step", async () => {
  const client = new FakeDataverseClient();
  const components = new FakeSolutionComponents();

  class TestService extends PluginService {
    deletions: string[] = [];
    async listSteps() {
      return [{ id: "step1", name: "one" } as any, { id: "step2", name: "two" } as any];
    }
    async deleteStep(stepId: string) {
      this.deletions.push(stepId);
    }
    async deletePluginType(id: string) {
      this.deletions.push(`type:${id}`);
    }
  }

  const service = new TestService(client as any, components as any);
  await service.deletePluginTypeCascade("plugin-type");

  assert.deepStrictEqual((service as any).deletions, ["step1", "step2", "type:plugin-type"]);
});

test("updateAssembly patches content on normalized id", async () => {
  const client = new FakeDataverseClient();
  const service = new PluginService(client as any, new FakeSolutionComponents() as any);

  await service.updateAssembly("{assembly-id}", "base64");

  const call = client.calls[0];
  assert.ok(call);
  assert.strictEqual(call.method, "PATCH");
  assert.strictEqual(call.path, "/pluginassemblies(assembly-id)");
  assert.deepStrictEqual(call.body, { content: "base64" });
});

test("updatePluginType patches provided fields and adds to solution when changed", async () => {
  const client = new FakeDataverseClient();
  const components = new FakeSolutionComponents();
  const service = new PluginService(client as any, components as any);

  await service.updatePluginType("{type-id}", {
    name: "New Name",
    typeName: "New.Type",
    friendlyName: "Friendly",
    description: "Desc",
    solutionName: "Core",
  });

  const patch = client.calls.find((c) => c.method === "PATCH");
  assert.ok(patch);
  assert.strictEqual(patch?.path, "/plugintypes(type-id)");
  assert.deepStrictEqual(patch?.body, {
    name: "New Name",
    typename: "New.Type",
    friendlyname: "Friendly",
    description: "Desc",
  });
  assert.deepStrictEqual(components.calls, [
    { id: "type-id", type: SolutionComponentType.PluginType, solution: "Core" },
  ]);
});

test("updatePluginType only ensures solution when no changes sent", async () => {
  const client = new FakeDataverseClient();
  const components = new FakeSolutionComponents();
  const service = new PluginService(client as any, components as any);

  await service.updatePluginType("type-id", { solutionName: "Core" });

  assert.strictEqual(client.calls.length, 0);
  assert.deepStrictEqual(components.calls, [
    { id: "type-id", type: SolutionComponentType.PluginType, solution: "Core" },
  ]);
});

test("deletePluginType sends delete with normalized id", async () => {
  const client = new FakeDataverseClient();
  const service = new PluginService(client as any, new FakeSolutionComponents() as any);

  await service.deletePluginType("{type-id}");

  assert.deepStrictEqual(client.calls, [{ method: "DELETE", path: "/plugintypes(type-id)" }]);
});

test("listAssemblies filters by solution component ids", async () => {
  const client = new FakeDataverseClient();
  const components = new FakeSolutionComponents();
  components.componentIds = new Set(["id-1"]);

  client.addResponse(
    "GET",
    "/pluginassemblies?$select=pluginassemblyid,name,version,isolationmode,publickeytoken,culture,sourcetype,modifiedon&$orderby=name",
    {
      value: [
        { pluginassemblyid: "id-1", name: "One" },
        { pluginassemblyid: "id-2", name: "Two" },
      ],
    },
  );

  const service = new PluginService(client as any, components as any);
  const assemblies = await service.listAssemblies({ solutionNames: ["Core"] });

  assert.deepStrictEqual(
    assemblies.map((a) => a.id),
    ["id-1"],
  );
});

test("listPluginTypes returns normalized ids and fields", async () => {
  const client = new FakeDataverseClient();
  client.addResponse(
    "GET",
    "/plugintypes?$select=plugintypeid,name,typename,friendlyname&$filter=_pluginassemblyid_value%20eq%20assembly-id",
    {
      value: [
        {
          plugintypeid: "{id-1}",
          name: "Name",
          typename: "Type",
          friendlyname: "Friendly",
        },
      ],
    },
  );

  const service = new PluginService(client as any, new FakeSolutionComponents() as any);
  const types = await service.listPluginTypes("assembly-id");

  assert.deepStrictEqual(types, [
    { id: "id-1", name: "Name", friendlyName: "Friendly", typeName: "Type" },
  ]);
});

test("listSteps maps step details", async () => {
  const client = new FakeDataverseClient();
  client.addResponse(
    "GET",
    "/sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,stage,mode,rank,statecode,statuscode,filteringattributes&$filter=_eventhandler_value%20eq%20type-id&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode)",
    {
      value: [
        {
          sdkmessageprocessingstepid: "{step-1}",
          name: "Step",
          stage: 40,
          mode: 0,
          rank: 1,
          statecode: 0,
          statuscode: 1,
          filteringattributes: "fullname",
          sdkmessageid: { name: "Update" },
          sdkmessagefilterid: { primaryobjecttypecode: "contact" },
        },
      ],
    },
  );

  const service = new PluginService(client as any, new FakeSolutionComponents() as any);
  const steps = await service.listSteps("type-id");

  assert.deepStrictEqual(steps, [
    {
      id: "step-1",
      name: "Step",
      mode: 0,
      stage: 40,
      rank: 1,
      status: 0,
      statusReason: 1,
      messageName: "Update",
      primaryEntity: "contact",
      filteringAttributes: "fullname",
    },
  ]);
});

test("listImages maps image details", async () => {
  const client = new FakeDataverseClient();
  client.addResponse(
    "GET",
    "/sdkmessageprocessingstepimages?$select=sdkmessageprocessingstepimageid,name,imagetype,entityalias,attributes,messagepropertyname&$filter=_sdkmessageprocessingstepid_value%20eq%20step-id",
    {
      value: [
        {
          sdkmessageprocessingstepimageid: "{img-1}",
          name: "Image",
          imagetype: 0,
          entityalias: "pre",
          attributes: "fullname",
          messagepropertyname: "Target",
        },
      ],
    },
  );

  const service = new PluginService(client as any, new FakeSolutionComponents() as any);
  const images = await service.listImages("step-id");

  assert.deepStrictEqual(images, [
    {
      id: "img-1",
      name: "Image",
      type: 0,
      entityAlias: "pre",
      attributes: "fullname",
      messagePropertyName: "Target",
    },
  ]);
});

test("listSdkMessageNames follows paging and deduplicates", async () => {
  const client = new FakeDataverseClient();
  client.addResponse("GET", "/sdkmessages?$select=name&$orderby=name&$filter=isprivate eq false", {
    value: [{ name: "Create" }, { name: "Update" }],
    "@odata.nextLink": "/next",
  });
  client.addResponse("GET", "/next", { value: [{ name: "Update" }, { name: "Delete" }] });

  const service = new PluginService(client as any, new FakeSolutionComponents() as any);
  const names = await service.listSdkMessageNames();

  assert.deepStrictEqual(names.sort(), ["Create", "Delete", "Update"]);
});

test("listEntityLogicalNames follows paging", async () => {
  const client = new FakeDataverseClient();
  client.addResponse("GET", "/EntityDefinitions?$select=LogicalName", {
    value: [{ LogicalName: "account" }],
    "@odata.nextLink": "/entities?page=2",
  });
  client.addResponse("GET", "/entities?page=2", { value: [{ LogicalName: "contact" }] });

  const service = new PluginService(client as any, new FakeSolutionComponents() as any);
  const names = await service.listEntityLogicalNames();

  assert.deepStrictEqual(names.sort(), ["account", "contact"]);
});

test("listEntityAttributeLogicalNames follows paging for entity", async () => {
  const client = new FakeDataverseClient();
  client.addResponse(
    "GET",
    "/EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName",
    {
      value: [{ LogicalName: "name" }],
      "@odata.nextLink": "/attributes?page=2",
    },
  );
  client.addResponse("GET", "/attributes?page=2", { value: [{ LogicalName: "address1_city" }] });

  const service = new PluginService(client as any, new FakeSolutionComponents() as any);
  const attrs = await service.listEntityAttributeLogicalNames("account");

  assert.deepStrictEqual(attrs.sort(), ["address1_city", "name"]);
});

test("resolveSdkMessageId returns normalized id or undefined", async () => {
  const client = new FakeDataverseClient();
  client.addResponse(
    "GET",
    "/sdkmessages?$select=sdkmessageid,name&$filter=name%20eq%20'Create'&$top=1",
    { value: [{ sdkmessageid: "{id-1}" }] },
  );
  const service = new PluginService(client as any, new FakeSolutionComponents() as any);

  const found = await (service as any).resolveSdkMessageId("Create");
  const missing = await (service as any).resolveSdkMessageId("Missing");

  assert.strictEqual(found, "id-1");
  assert.strictEqual(missing, undefined);
});

test("resolveSdkMessageFilterId returns normalized id or undefined", async () => {
  const client = new FakeDataverseClient();
  client.addResponse(
    "GET",
    "/sdkmessagefilters?$select=sdkmessagefilterid,primaryobjecttypecode&$filter=_sdkmessageid_value%20eq%20msg-id%20and%20primaryobjecttypecode%20eq%20'account'&$top=1",
    { value: [{ sdkmessagefilterid: "{filter-id}" }] },
  );

  const service = new PluginService(client as any, new FakeSolutionComponents() as any);
  const found = await (service as any).resolveSdkMessageFilterId("msg-id", "account");
  const missing = await (service as any).resolveSdkMessageFilterId("msg-id", "contact");

  assert.strictEqual(found, "filter-id");
  assert.strictEqual(missing, undefined);
});

test("getStepMessageId returns normalized id", async () => {
  const client = new FakeDataverseClient();
  client.addResponse(
    "GET",
    "/sdkmessageprocessingsteps(step-1)?$select=sdkmessageprocessingstepid&$expand=sdkmessageid($select=sdkmessageid)",
    { sdkmessageid: { sdkmessageid: "{msg-id}" } },
  );

  const service = new PluginService(client as any, new FakeSolutionComponents() as any);
  const id = await (service as any).getStepMessageId("step-1");

  assert.strictEqual(id, "msg-id");
});

test("normalizeGuid removes braces", () => {
  const service = new PluginService({} as any, {} as any);
  assert.strictEqual((service as any).normalizeGuid("{abc}"), "abc");
});
