import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";
import { VsCodeOutputLogger } from "../outputLogger";

test("VsCodeOutputLogger writes Dataverse error metadata to output", () => {
  const lines: string[] = [];
  let shown = false;
  let disposed = false;
  const originalCreateOutputChannel = vscode.window.createOutputChannel;

  (vscode.window as any).createOutputChannel = () => ({
    appendLine: (line: string) => lines.push(line),
    show: () => {
      shown = true;
    },
    dispose: () => {
      disposed = true;
    },
  });

  try {
    const logger = new VsCodeOutputLogger();
    const error = new Error("Dataverse PATCH accounts(id): Request failed (429)");
    (error as any).code = "0x80040265";
    (error as any).status = 429;
    (error as any).correlationId = "corr-123";
    (error as any).requestMethod = "PATCH";
    (error as any).requestPath = "accounts(id)";
    (error as any).requestUrl = "https://org.crm.dynamics.com/api/data/v9.2/accounts(id)";
    (error as any).causeChain = "TypeError: fetch failed -> SocketError: reset";
    (error as any).rawBody = '{"error":{"message":"rate limited"}}';

    logger.error("Publish Resource failed", error, {
      commandId: "dynamics365Tools.publishResource",
    });
    logger.show();
    logger.dispose();
  } finally {
    (vscode.window as any).createOutputChannel = originalCreateOutputChannel;
  }

  const output = lines.join("\n");
  assert.match(output, /ERROR Publish Resource failed/);
  assert.match(output, /commandId: dynamics365Tools\.publishResource/);
  assert.match(output, /Code: 0x80040265/);
  assert.match(output, /Status: 429/);
  assert.match(output, /CorrelationId: corr-123/);
  assert.match(output, /Request: PATCH accounts\(id\)/);
  assert.match(output, /Url: https:\/\/org\.crm\.dynamics\.com\/api\/data\/v9\.2\/accounts\(id\)/);
  assert.match(output, /CauseChain: TypeError: fetch failed -> SocketError: reset/);
  assert.match(output, /Response: \{"error":\{"message":"rate limited"\}\}/);
  assert.strictEqual(shown, true);
  assert.strictEqual(disposed, true);
});
