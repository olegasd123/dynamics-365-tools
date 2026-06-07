export interface OpenFileDialogOptions {
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  canSelectMany?: boolean;
  defaultPath?: string;
  filters?: Record<string, string[]>;
  openLabel?: string;
  title?: string;
}

export interface FileDialogPort {
  showOpenDialog(options: OpenFileDialogOptions): Promise<string[] | undefined>;
}

export class NoopFileDialogs implements FileDialogPort {
  async showOpenDialog(): Promise<string[] | undefined> {
    return undefined;
  }
}
