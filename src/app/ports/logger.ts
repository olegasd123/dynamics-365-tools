export type LogMetadata = Record<string, unknown>;

export interface LoggerPort {
  info(message: string, metadata?: LogMetadata): void;
  error(message: string, error?: unknown, metadata?: LogMetadata): void;
  show(): void;
}

export class NoopLogger implements LoggerPort {
  info(): void {}

  error(): void {}

  show(): void {}
}
