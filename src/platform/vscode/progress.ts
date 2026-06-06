import * as vscode from "vscode";
import type { ProgressOptions, ProgressPort, ProgressReporter } from "../../app/ports/progress";

export class VsCodeProgress implements ProgressPort {
  async withProgress<T>(
    options: ProgressOptions,
    task: (progress: ProgressReporter, token: vscode.CancellationToken) => Thenable<T>,
  ): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: options.title,
        cancellable: options.cancellable,
      },
      task,
    );
  }
}
