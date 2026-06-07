const path = require("path");

// This shim intentionally covers only VS Code surfaces still exercised by tests:
// UI prompts/webviews/tree/status bars, command registration, diagnostics, and URI helpers.

class Uri {
  constructor(fsPath) {
    this.fsPath = path.normalize(fsPath);
    this.path = this.fsPath;
    this.scheme = "file";
  }

  static file(fsPath) {
    return new Uri(fsPath);
  }

  static parse(value) {
    return new Uri(value);
  }

  static joinPath(base, ...paths) {
    return Uri.file(path.join(base.fsPath, ...paths));
  }
}

const workspace = {
  workspaceFolders: undefined,
};

const window = {
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
  showSaveDialog: async () => undefined,
  showTextDocument: async () => undefined,
  withProgress: async (_options, task) => {
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    };
    return task({ report: () => {} }, token);
  },
  setStatusBarMessage: () => ({ dispose: () => {} }),
  createOutputChannel: () => {
    const lines = [];
    return {
      appendLine: (line) => lines.push(line),
      show: () => {},
      dispose: () => {},
      logs: lines,
    };
  },
  createStatusBarItem: () => ({
    text: "",
    tooltip: "",
    command: undefined,
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  createTreeView: (_viewId, _options) => ({
    onDidChangeSelection: () => ({ dispose: () => {} }),
    reveal: async () => undefined,
    dispose: () => {},
  }),
  registerTreeDataProvider: () => ({ dispose: () => {} }),
  createWebviewPanel: (_viewType, title) => {
    const disposeEmitter = new EventEmitter();
    const messageEmitter = new EventEmitter();
    const panel = {
      title,
      webview: {
        html: "",
        onDidReceiveMessage: messageEmitter.event,
        __postMessage: (message) => messageEmitter.fire(message),
      },
      onDidDispose: disposeEmitter.event,
      dispose: () => disposeEmitter.fire(undefined),
    };
    window.__lastWebviewPanel = panel;
    return panel;
  },
  __lastWebviewPanel: undefined,
};

const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: async () => undefined,
};

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

const languages = {
  createDiagnosticCollection: () => ({
    entries: new Map(),
    set(uri, diagnostics) {
      this.entries.set(uri.fsPath, diagnostics);
    },
    delete(uri) {
      this.entries.delete(uri.fsPath);
    },
    clear() {
      this.entries.clear();
    },
    dispose() {
      this.entries.clear();
    },
  }),
};

const ProgressLocation = {
  Notification: 15,
};

const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

class EventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (listener) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          this.listeners = this.listeners.filter((item) => item !== listener);
        },
      };
    };
  }

  fire(value) {
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  dispose() {
    this.listeners = [];
  }
}

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

class TreeItem {
  constructor(label, collapsibleState = TreeItemCollapsibleState.None) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id) {
    this.id = id;
  }
}

class Disposable {
  constructor(callOnDispose = () => {}) {
    this.callOnDispose = callOnDispose;
  }

  dispose() {
    this.callOnDispose();
  }

  static from(...disposables) {
    return new Disposable(() => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    });
  }
}

const ViewColumn = {
  Beside: -2,
};

module.exports = {
  Uri,
  workspace,
  window,
  commands,
  languages,
  Position,
  Range,
  Diagnostic,
  DiagnosticSeverity,
  EventEmitter,
  ProgressLocation,
  StatusBarAlignment,
  TreeItem,
  TreeItemCollapsibleState,
  ThemeIcon,
  Disposable,
  ViewColumn,
};
