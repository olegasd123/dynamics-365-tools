export interface OutputChannelPort {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

export interface OutputPort {
  createChannel(name: string): OutputChannelPort;
}

class NoopOutputChannel implements OutputChannelPort {
  appendLine(): void {}

  show(): void {}

  dispose(): void {}
}

export class NoopOutputPort implements OutputPort {
  createChannel(): OutputChannelPort {
    return new NoopOutputChannel();
  }
}
