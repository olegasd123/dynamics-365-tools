export interface TextInputOptions {
  prompt?: string;
  placeHolder?: string;
  value?: string;
  ignoreFocusOut?: boolean;
  validateInput?(value: string): string | undefined | Promise<string | undefined>;
}

export interface QuickPickOptions {
  placeHolder?: string;
  ignoreFocusOut?: boolean;
}

export interface TextInputPort {
  showInputBox(options: TextInputOptions): Promise<string | undefined>;
  showQuickPick<T extends { label: string }>(
    items: readonly T[],
    options?: QuickPickOptions,
  ): Promise<T | undefined>;
}

export class NoopTextInput implements TextInputPort {
  async showInputBox(): Promise<string | undefined> {
    return undefined;
  }

  async showQuickPick(): Promise<undefined> {
    return undefined;
  }
}
