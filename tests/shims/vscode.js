const path = require("path");
const fs = require("fs/promises");

const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

class Uri {
  constructor(fsPath) {
    this.fsPath = path.normalize(fsPath);
    this.path = this.fsPath;
    this.scheme = "file";
  }

  static file(fsPath) {
    return new Uri(fsPath);
  }

  static joinPath(base, ...paths) {
    return Uri.file(path.join(base.fsPath, ...paths));
  }
}

const workspace = {
  workspaceFolders: undefined,
  fs: {
    async stat(uri) {
      const stats = await fs.stat(uri.fsPath);
      return {
        type: stats.isDirectory() ? FileType.Directory : FileType.File,
      };
    },
    async readFile(uri) {
      return fs.readFile(uri.fsPath);
    },
    async writeFile(uri, content) {
      await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
      await fs.writeFile(uri.fsPath, content);
    },
    async createDirectory(uri) {
      await fs.mkdir(uri.fsPath, { recursive: true });
    },
    async readDirectory(uri) {
      const entries = await fs.readdir(uri.fsPath, { withFileTypes: true });
      return entries.map((entry) => [
        entry.name,
        entry.isDirectory() ? FileType.Directory : FileType.File,
      ]);
    },
  },
};

const messages = {
  info: [],
  warn: [],
  error: [],
};

const window = {
  showInformationMessage: async (msg) => {
    messages.info.push(msg);
    return undefined;
  },
  showWarningMessage: async (msg) => {
    messages.warn.push(msg);
    return undefined;
  },
  showErrorMessage: async (msg) => {
    messages.error.push(msg);
    return undefined;
  },
  showInputBox: async () => undefined,
  showTextDocument: async () => undefined,
  createOutputChannel: () => {
    const lines = [];
    return {
      appendLine: (line) => lines.push(line),
      show: () => {},
      logs: lines,
    };
  },
  __messages: messages,
};

class InMemorySecretStorage {
  constructor() {
    this.map = new Map();
  }

  async get(key) {
    return this.map.get(key);
  }

  async store(key, value) {
    this.map.set(key, value);
  }

  async delete(key) {
    this.map.delete(key);
  }
}

const authentication = {
  getSession: async () => {
    throw new Error("authentication.getSession not stubbed");
  },
};

const commands = {
  registerCommand: () => ({ dispose: () => {} }),
};

module.exports = {
  Uri,
  workspace,
  window,
  commands,
  FileType,
  authentication,
  InMemorySecretStorage,
};
