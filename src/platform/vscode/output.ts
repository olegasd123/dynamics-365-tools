import * as vscode from "vscode";
import type { OutputChannelPort, OutputPort } from "@app/ports/output";

export class VsCodeOutputPort implements OutputPort {
  createChannel(name: string): OutputChannelPort {
    return vscode.window.createOutputChannel(name);
  }
}
