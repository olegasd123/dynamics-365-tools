export interface TextInputOptions {
  prompt?: string;
  placeHolder?: string;
  value?: string;
  ignoreFocusOut?: boolean;
  validateInput?(value: string): string | undefined | Promise<string | undefined>;
}

export interface TextInputPort {
  showInputBox(options: TextInputOptions): Promise<string | undefined>;
}

export class NoopTextInput implements TextInputPort {
  async showInputBox(): Promise<string | undefined> {
    return undefined;
  }
}
