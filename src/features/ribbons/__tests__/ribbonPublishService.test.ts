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

test("publishDocuments preflights entities, imports, then publishes ribbons", async () => {
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
    "/EntityDefinitions(LogicalName='account')?$select=LogicalName",
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
});

test("createGeneratedSolution uses the publisher that owns the selected prefix", async () => {
  const client = new FakeClient();
  const solution = await new RibbonPublishService().createGeneratedSolution(
    client,
    "new",
    "account",
  );

  assert.match(solution.uniqueName, /^d365tools_ribbon_account_/);
  assert.strictEqual(solution.solutionId, "solution-id");
  assert.strictEqual(solution.publisherPrefix, "new");
  assert.strictEqual(solution.publisherUniqueName, "newpublisher");
  assert.strictEqual(client.posts[0].path, "/solutions");
  assert.strictEqual(client.posts[0].body["publisherid@odata.bind"], "/publishers(pub-id)");
});

test("createGeneratedSolutionFromDefaultPublisher uses the Default solution publisher", async () => {
  const client = new FakeClient();
  const solution = await new RibbonPublishService().createGeneratedSolutionFromDefaultPublisher(
    client,
    "account",
  );

  assert.match(solution.uniqueName, /^d365tools_ribbon_account_/);
  assert.strictEqual(solution.solutionId, "solution-id");
  assert.strictEqual(solution.publisherPrefix, "new");
  assert.strictEqual(solution.publisherUniqueName, "newpublisher");
  assert.strictEqual(
    client.gets[0],
    "/solutions?$select=solutionid,uniquename&$expand=publisherid($select=publisherid,uniquename,customizationprefix)&$filter=uniquename eq 'Default'&$top=1",
  );
  assert.strictEqual(client.posts[0].path, "/solutions");
  assert.strictEqual(client.posts[0].body["publisherid@odata.bind"], "/publishers(pub-id)");
});

test("deleteGeneratedSolutionByUniqueName resolves and deletes the generated solution", async () => {
  const client = new FakeClient();

  await new RibbonPublishService().deleteGeneratedSolutionByUniqueName(
    client,
    "d365tools_ribbon_account_20260101010101",
  );

  assert.strictEqual(
    client.gets[0],
    "/solutions?$select=solutionid,uniquename&$filter=uniquename eq 'd365tools_ribbon_account_20260101010101'&$top=1",
  );
  assert.deepStrictEqual(client.deletes, ["/solutions(solution-id)"]);
});

class FakeClient {
  readonly gets: string[] = [];
  readonly posts: Array<{ path: string; body: any }> = [];
  readonly deletes: string[] = [];

  async get<T>(path: string): Promise<T> {
    this.gets.push(path);
    if (path.startsWith("/EntityDefinitions")) {
      return { LogicalName: "account" } as T;
    }
    if (path === "RetrieveVersion()") {
      return { Version: "9.2.26043.165" } as T;
    }
    if (path.startsWith("/publishers")) {
      return {
        value: [
          {
            publisherid: "pub-id",
            uniquename: "newpublisher",
            customizationprefix: "new",
          },
        ],
      } as T;
    }
    if (path.includes("uniquename eq 'Default'")) {
      return {
        value: [
          {
            solutionid: "default-solution-id",
            uniquename: "Default",
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
    if (path === "/solutions") {
      return { solutionid: "solution-id" } as T;
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
