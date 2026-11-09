import * as vscode from "vscode";

export class TestQuickPick<T extends vscode.QuickPickItem = vscode.QuickPickItem> {
  items: readonly T[] = [];
  selectedItems: readonly T[] = [];
  value = "";
  title = "";
  placeholder = "";
  ignoreFocusOut = false;
  matchOnDescription = false;
  disposed = false;
  shown = false;
  private isBusy = false;
  private choosing = false;
  private readonly change = new vscode.EventEmitter<string>();
  private readonly accept = new vscode.EventEmitter<void>();
  private readonly hide = new vscode.EventEmitter<void>();
  readonly onDidChangeValue = this.change.event;
  readonly onDidAccept = this.accept.event;
  readonly onDidHide = this.hide.event;

  constructor(private readonly choose?: (picker: TestQuickPick<T>) => Promise<T | undefined>) {}

  get busy(): boolean {
    return this.isBusy;
  }

  set busy(value: boolean) {
    this.isBusy = value;
    this.chooseWhenReady();
  }

  show(): void {
    this.shown = true;
    this.chooseWhenReady();
  }

  type(value: string): void {
    this.value = value;
    this.change.fire(value);
  }

  select(item?: T): void {
    this.selectedItems = item ? [item] : [];
    this.accept.fire();
  }

  dismiss(): void {
    this.hide.fire();
  }

  dispose(): void {
    this.disposed = true;
    this.change.dispose();
    this.accept.dispose();
    this.hide.dispose();
  }

  private chooseWhenReady(): void {
    queueMicrotask(() => {
      if (!this.choose || !this.shown || this.busy || this.disposed || this.choosing) {
        return;
      }
      this.choosing = true;
      void this.choose(this).then((pick) => (pick ? this.select(pick) : this.dismiss()));
    });
  }
}
