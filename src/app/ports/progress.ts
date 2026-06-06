export interface ProgressOptions {
  title: string;
  cancellable?: boolean;
}

export interface ProgressReporter {
  report(value: { message?: string; increment?: number }): void;
}

export interface CancellationTokenLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested?(listener: () => void): { dispose(): void };
}

export interface ProgressPort {
  withProgress<T>(
    options: ProgressOptions,
    task: (progress: ProgressReporter, token: CancellationTokenLike) => Thenable<T>,
  ): Promise<T>;
}

const neverCancelledToken: CancellationTokenLike = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
};

export class NoopProgress implements ProgressPort {
  async withProgress<T>(
    _options: ProgressOptions,
    task: (progress: ProgressReporter, token: CancellationTokenLike) => Thenable<T>,
  ): Promise<T> {
    return task({ report: () => undefined }, neverCancelledToken);
  }
}
