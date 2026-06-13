import * as vscode from "vscode";
import type { NotificationOptions, NotificationPort } from "@app/ports/notifications";

export class VsCodeNotificationService implements NotificationPort {
  async info(message: string): Promise<void> {
    showPassiveNotification(() => vscode.window.showInformationMessage(message));
  }

  async warning(message: string): Promise<void> {
    showPassiveNotification(() => vscode.window.showWarningMessage(message));
  }

  async error(message: string): Promise<void> {
    showPassiveNotification(() => vscode.window.showErrorMessage(message));
  }

  async askInfo<T extends string>(
    message: string,
    actions: readonly T[],
    options?: NotificationOptions,
  ): Promise<T | undefined> {
    return vscode.window.showInformationMessage(message, options ?? {}, ...actions);
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

function showPassiveNotification(show: () => Thenable<unknown>): void {
  try {
    void Promise.resolve(show()).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    // Passive notifications must not keep a command running or fail it.
  }
}
