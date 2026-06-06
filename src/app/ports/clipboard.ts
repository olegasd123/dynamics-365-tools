export interface ClipboardPort {
  writeText(value: string): Promise<void>;
}

export class NoopClipboard implements ClipboardPort {
  async writeText(): Promise<void> {}
}
