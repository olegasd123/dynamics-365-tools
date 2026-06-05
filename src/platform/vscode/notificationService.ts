import * as vscode from "vscode";
import type { NotificationOptions, NotificationPort } from "../../app/ports/notifications";

export class VsCodeNotificationService implements NotificationPort {
  async info(message: string): Promise<void> {
    await vscode.window.showInformationMessage(message);
  }

  async warning(message: string): Promise<void> {
    await vscode.window.showWarningMessage(message);
  }

  async error(message: string): Promise<void> {
    await vscode.window.showErrorMessage(message);
  }

  async askWarning<T extends string>(
    message: string,
    actions: readonly T[],
    options?: NotificationOptions,
  ): Promise<T | undefined> {
    return vscode.window.showWarningMessage(message, options ?? {}, ...actions);
  }

  async askError<T extends string>(
    message: string,
    actions: readonly T[],
    options?: NotificationOptions,
  ): Promise<T | undefined> {
    return vscode.window.showErrorMessage(message, options ?? {}, ...actions);
  }
}
