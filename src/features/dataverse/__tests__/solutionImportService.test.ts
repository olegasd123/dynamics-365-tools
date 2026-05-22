import assert from "node:assert";
import test from "node:test";
import {
  buildPublishCustomControlsXml,
  buildPublishRibbonsXml,
  SolutionImportError,
  SolutionImportService,
} from "../solutionImportService";

test("SolutionImportService starts async import and polls until success", async () => {
  const posts: Array<{ path: string; body: any }> = [];
  const gets: string[] = [];
  const client = {
    post: async <T>(path: string, body: any): Promise<T> => {
      posts.push({ path, body });
      return {
        AsyncOperationId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
      } as T;
    },
    get: async <T>(path: string): Promise<T> => {
      gets.push(path);
      if (path.startsWith("/asyncoperations")) {
        return { statecode: 3, statuscode: 30 } as T;
      }
      return { data: "<importexportxml />" } as T;
    },
  };

  const service = new SolutionImportService(client);
  const result = await service.importSolution(Buffer.from("zip"), {
    importJobId: "11111111-2222-3333-4444-555555555555",
    pollIntervalMs: 0,
  });

  assert.strictEqual(result.importJobId, "11111111-2222-3333-4444-555555555555");
  assert.strictEqual(result.asyncOperationId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.deepStrictEqual(posts, [
    {
      path: "ImportSolutionAsync",
      body: {
        OverwriteUnmanagedCustomizations: false,
        PublishWorkflows: true,
        CustomizationFile: Buffer.from("zip").toString("base64"),
        ImportJobId: "11111111-2222-3333-4444-555555555555",
      },
    },
  ]);
  assert.deepStrictEqual(gets, [
    "/asyncoperations(aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)?$select=asyncoperationid,statecode,statuscode,message,friendlymessage,errortext",
    "/importjobs(11111111-2222-3333-4444-555555555555)?$select=importjobid,data,progress,solutionname",
  ]);
});

test("SolutionImportService surfaces failed import log messages", async () => {
  const client = {
    post: async <T>(): Promise<T> =>
      ({ AsyncOperationId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }) as T,
    get: async <T>(path: string): Promise<T> => {
      if (path.startsWith("/asyncoperations")) {
        return { statecode: 3, statuscode: 31, message: "Import failed" } as T;
      }
      return {
        data: `<importexportxml><solutionManifest result="failure" errortext="Missing dependency" /></importexportxml>`,
      } as T;
    },
  };

  const service = new SolutionImportService(client);
  await assert.rejects(
    () =>
      service.importSolution(Buffer.from("zip"), {
        importJobId: "11111111-2222-3333-4444-555555555555",
        pollIntervalMs: 0,
      }),
    (error: unknown) => {
      assert.ok(error instanceof SolutionImportError);
      assert.match(error.message, /Import failed/);
      assert.match(error.message, /Missing dependency/);
      assert.match(error.log ?? "", /Missing dependency/);
      return true;
    },
  );
});

test("buildPublishCustomControlsXml creates scoped PublishXml payload", () => {
  assert.strictEqual(
    buildPublishCustomControlsXml(["{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}"]),
    "<importexportxml><customcontrols><customcontrol>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</customcontrol></customcontrols></importexportxml>",
  );
});

test("buildPublishRibbonsXml creates entity and app ribbon payload", () => {
  assert.strictEqual(
    buildPublishRibbonsXml(["account", "contact"], true),
    "<importexportxml><entities><entity>account</entity><entity>contact</entity></entities><ribbon /></importexportxml>",
  );
});
