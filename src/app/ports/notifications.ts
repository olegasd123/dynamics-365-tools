export interface NotificationOptions {
  modal?: boolean;
  detail?: string;
}

export interface NotificationPort {
  info(message: string): Promise<void>;
  warning(message: string): Promise<void>;
  error(message: string): Promise<void>;
  askInfo<T extends string>(
    message: string,
    actions: readonly T[],
    options?: NotificationOptions,
  ): Promise<T | undefined>;
  askWarning<T extends string>(
    message: string,
    actions: readonly T[],
    options?: NotificationOptions,
  ): Promise<T | undefined>;
  askError<T extends string>(
    message: string,
    actions: readonly T[],
    options?: NotificationOptions,
  ): Promise<T | undefined>;
}

export class NoopNotificationService implements NotificationPort {
  async info(): Promise<void> {}

  async warning(): Promise<void> {}

  async error(): Promise<void> {}

  async askInfo<T extends string>(): Promise<T | undefined> {
    return undefined;
  }

  async askWarning<T extends string>(): Promise<T | undefined> {
    return undefined;
  }

  async askError<T extends string>(): Promise<T | undefined> {
    return undefined;
  }
}
