import assert from "node:assert";
import test from "node:test";
import JSZip from "jszip";
import { RibbonDocument } from "../models";
import {
  buildMinimalRibbonSolutionZip,
  buildRibbonPublishTarget,
  RibbonPublishService,
} from "../ribbonPublishService";

test("buildRibbonPublishTarget extracts entity and application ribbon XML", () => {
  const entity = makeDocument(
    "Entity",
    "account",
    `<RibbonDiffXml><CustomActions /></RibbonDiffXml>`,
  );
  const app = makeDocument(
    "Application",
    undefined,
    `<RibbonDiffXml><LocLabels /></RibbonDiffXml>`,
  );

  const target = buildRibbonPublishTarget([entity, app]);

  assert.deepStrictEqual(target.entities, ["account"]);
  assert.strictEqual(
    target.entityRibbonXmlByName.get("account"),
    "<RibbonDiffXml><CustomActions /></RibbonDiffXml>",
  );
  assert.strictEqual(target.applicationRibbonXml, "<RibbonDiffXml><LocLabels /></RibbonDiffXml>");
});

test("buildRibbonPublishTarget normalizes entity logical names", () => {
  const document = makeDocument(
    "Entity",
    " Account ",
    `<RibbonDiffXml><CustomActions /></RibbonDiffXml>`,
  );

  const target = buildRibbonPublishTarget([document]);

  assert.deepStrictEqual(target.entities, ["account"]);
  assert.strictEqual(
    target.entityRibbonXmlByName.get("account"),
    "<RibbonDiffXml><CustomActions /></RibbonDiffXml>",
  );
});

test("buildMinimalRibbonSolutionZip creates the expected solution entries", async () => {
  const document = makeDocument(
    "Entity",
    "account",
    `<RibbonDiffXml><CustomActions><HideCustomAction HideActionId="new.Hide" Location="Mscrm.Form.account.MainTab.Save.Controls._children" /></CustomActions></RibbonDiffXml>`,
  );
  const target = buildRibbonPublishTarget([document]);

  const zipBytes = await buildMinimalRibbonSolutionZip({
    ...target,
    solution: {
      uniqueName: "Core",
      friendlyName: "Core Solution",
      publisherPrefix: "new",
      publisherUniqueName: "newpublisher",
    },
  });
  const zip = await JSZip.loadAsync(zipBytes);

  assert.ok(zip.file("[Content_Types].xml"));
  assert.ok(zip.file("solution.xml"));
  assert.ok(zip.file("customizations.xml"));
  assert.match(
    (await zip.file("solution.xml")?.async("string")) ?? "",
    /<RootComponent type="1" schemaName="account" behavior="0" \/>/,
  );
  assert.match(
    (await zip.file("solution.xml")?.async("string")) ?? "",
    /<ImportExportXml version="9\.2\.0\.0" SolutionPackageVersion="9\.2" languagecode="1033" generatedBy="CrmLive" xmlns:xsi="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance">/,
  );
  assert.match(
    (await zip.file("customizations.xml")?.async("string")) ?? "",
    /<Name>account<\/Name>\s+<RibbonDiffXml>/,
  );
  assert.match(
    (await zip.file("customizations.xml")?.async("string")) ?? "",
    /<ImportExportXml version="9\.2\.0\.0" SolutionPackageVersion="9\.2" languagecode="1033" generatedBy="CrmLive" xmlns:xsi="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance">/,
  );
});

test("publishDocuments preflights entities, imports, publishes ribbons, and queues metadata", async () => {
  const client = new FakeClient();
  const document = makeDocument(
    "Entity",
    "account",
    `<RibbonDiffXml><CustomActions /></RibbonDiffXml>`,
  );
  const service = new RibbonPublishService();

  const result = await service.publishDocuments(
    client,
    [document],
    {
      uniqueName: "Core",
      solutionId: "core-solution-id",
      publisherPrefix: "new",
      publisherUniqueName: "newpublisher",
    },
    { pollIntervalMs: 0 },
  );

  const importJobId = client.posts[0].body.ImportJobId;
  const publishedZip = await JSZip.loadAsync(
    Buffer.from(client.posts[0].body.CustomizationFile, "base64"),
  );
  assert.deepStrictEqual(result.entities, ["account"]);
  assert.deepStrictEqual(client.gets, [
    "/EntityDefinitions(LogicalName='account')?$select=LogicalName,MetadataId",
    `/solutioncomponents?$select=solutioncomponentid&$filter=${encodeURIComponent(
      "componenttype eq 1 and objectid eq entity-id and _solutionid_value eq core-solution-id",
    )}&$top=1`,
    "RetrieveVersion()",
    "/asyncoperations(aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)?$select=asyncoperationid,statecode,statuscode,message,friendlymessage",
    `/importjobs(${importJobId})?$select=importjobid,data,progress,solutionname`,
  ]);
  assert.strictEqual(client.posts[0].path, "ImportSolutionAsync");
  assert.strictEqual(client.posts[0].body.OverwriteUnmanagedCustomizations, true);
  assert.strictEqual(client.posts[0].body.PublishWorkflows, false);
  assert.match(
    (await publishedZip.file("solution.xml")?.async("string")) ?? "",
    /<ImportExportXml version="9\.2\.26043\.165" SolutionPackageVersion="9\.2"/,
  );
  assert.strictEqual(client.posts[1].path, "PublishXml");
  assert.deepStrictEqual(client.posts[1].body, {
    ParameterXml:
      "<importexportxml><entities><entity>account</entity></entities></importexportxml>",
  });
  assert.strictEqual(client.posts[2].path, "QueueUpdateRibbonClientMetadata");
  assert.strictEqual(client.posts[2].body, undefined);
});

test("publishDocuments blocks entities that are not in the selected solution", async () => {
  const client = new FakeClient();
  client.entityInSolution = false;
  const document = makeDocument(
    "Entity",
    "account",
    `<RibbonDiffXml><CustomActions /></RibbonDiffXml>`,
  );

  await assert.rejects(
    new RibbonPublishService().publishDocuments(
      client,
      [document],
      {
        uniqueName: "Other",
        solutionId: "other-solution-id",
        publisherPrefix: "new",
        publisherUniqueName: "newpublisher",
      },
      { pollIntervalMs: 0 },
    ),
    /Selected solution Other does not contain account/,
  );

  assert.deepStrictEqual(client.posts, []);
});

test("listUnmanagedSolutions maps publisher data for publish choices", async () => {
  const client = new FakeClient();
  const solutions = await new RibbonPublishService().listUnmanagedSolutions(client);

  assert.deepStrictEqual(solutions, [
    {
      solutionId: "core-solution-id",
      uniqueName: "core",
      friendlyName: "Core",
      publisherPrefix: "new",
      publisherUniqueName: "newpublisher",
    },
  ]);
});

class FakeClient {
  readonly gets: string[] = [];
  readonly posts: Array<{ path: string; body: any }> = [];
  readonly deletes: string[] = [];
  entityInSolution = true;

  async get<T>(path: string): Promise<T> {
    this.gets.push(path);
    if (path.startsWith("/EntityDefinitions")) {
      return { LogicalName: "account", MetadataId: "{entity-id}" } as T;
    }
    if (path.startsWith("/solutioncomponents?$select=solutioncomponentid")) {
      return {
        value: this.entityInSolution ? [{ solutioncomponentid: "component-id" }] : [],
      } as T;
    }
    if (path === "RetrieveVersion()") {
      return { Version: "9.2.26043.165" } as T;
    }
    if (path.startsWith("/solutions?$select=solutionid,uniquename,friendlyname&$expand")) {
      return {
        value: [
          {
            solutionid: "core-solution-id",
            uniquename: "core",
            friendlyname: "Core",
            publisherid: {
              publisherid: "pub-id",
              uniquename: "newpublisher",
              customizationprefix: "new",
            },
          },
        ],
      } as T;
    }
    if (path.includes("d365tools_ribbon_account_20260101010101")) {
      return {
        value: [
          {
            solutionid: "solution-id",
            uniquename: "d365tools_ribbon_account_20260101010101",
          },
        ],
      } as T;
    }
    if (path.startsWith("/asyncoperations")) {
      return { statecode: 3, statuscode: 30 } as T;
    }
    if (path.startsWith("/importjobs")) {
      return { data: "<importexportxml />" } as T;
    }
    return {} as T;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    this.posts.push({ path, body });
    if (path === "ImportSolutionAsync") {
      return {
        AsyncOperationId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
        ImportJobKey: "11111111-2222-3333-4444-555555555555",
      } as T;
    }
    return {} as T;
  }

  async delete(path: string): Promise<void> {
    this.deletes.push(path);
  }
}

function makeDocument(
  kind: RibbonDocument["kind"],
  entityLogicalName: string | undefined,
  ribbonXml: string,
): RibbonDocument {
  return {
    id: `${kind}:${entityLogicalName ?? "app"}`,
    sourceId: "source",
    kind,
    entityLogicalName,
    fileUri: "/tmp/RibbonDiffXml.xml",
    sourceText: `before${ribbonXml}after`,
    ribbonRange: { start: "before".length, end: "before".length + ribbonXml.length },
    sections: {},
    views: [],
  };
}
