// Lightweight vscode mock for unit testing.
// Only implements what CodeDiary actually uses.

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data: T): void {
    for (const l of this.listeners) { l(data); }
  }
  dispose(): void { this.listeners = []; }
}

export class Uri {
  constructor(public readonly fsPath: string, public readonly scheme = 'file') {}
  static file(p: string): Uri { return new Uri(p); }
  toString(): string { return this.fsPath; }
}

export class Range {
  constructor(
    public readonly startLine: number,
    public readonly startCharacter: number,
    public readonly endLine: number,
    public readonly endCharacter: number,
  ) {}
}

export class ThemeIcon {
  constructor(public readonly id: string, public readonly color?: ThemeColor) {}
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class MarkdownString {
  value = '';
  constructor(value?: string) { if (value) this.value = value; }
  appendMarkdown(s: string): void { this.value += s; }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label?: string;
  description?: string;
  tooltip?: MarkdownString | string;
  iconPath?: ThemeIcon;
  contextValue?: string;
  command?: any;
  collapsibleState?: TreeItemCollapsibleState;

  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum OverviewRulerLane {
  Left = 1,
  Center = 2,
  Right = 4,
}

export enum ProgressLocation {
  Notification = 15,
}

// --- Configurable workspace mock ---

let _workspaceFolders: { uri: Uri; name: string; index: number }[] | undefined;
let _configValues: Record<string, any> = {};

/** Test helper: set the mock workspace folder */
export function __setWorkspaceFolder(fsPath: string): void {
  _workspaceFolders = [{ uri: Uri.file(fsPath), name: 'test', index: 0 }];
}

/** Test helper: clear workspace */
export function __clearWorkspace(): void {
  _workspaceFolders = undefined;
}

/** Test helper: set config values */
export function __setConfig(values: Record<string, any>): void {
  _configValues = values;
}

export const workspace = {
  get workspaceFolders() { return _workspaceFolders; },
  getWorkspaceFolder(uri: Uri) {
    if (!_workspaceFolders) return undefined;
    return _workspaceFolders[0];
  },
  asRelativePath(uri: Uri | string, _includeWorkspace?: boolean): string {
    const p = typeof uri === 'string' ? uri : uri.fsPath;
    if (!_workspaceFolders) return p;
    const base = _workspaceFolders[0].uri.fsPath;
    if (p.startsWith(base)) {
      let rel = p.slice(base.length);
      if (rel.startsWith('/') || rel.startsWith('\\')) rel = rel.slice(1);
      return rel;
    }
    return p;
  },
  getConfiguration(_section?: string) {
    return {
      get<T>(key: string, defaultValue?: T): T {
        const fullKey = _section ? `${_section}.${key}` : key;
        return (fullKey in _configValues ? _configValues[fullKey] : defaultValue) as T;
      },
    };
  },
  createFileSystemWatcher(_pattern: any) {
    return {
      onDidChange: () => ({ dispose: () => {} }),
      onDidCreate: () => ({ dispose: () => {} }),
      onDidDelete: () => ({ dispose: () => {} }),
      dispose: () => {},
    };
  },
  onDidOpenTextDocument: () => ({ dispose: () => {} }),
  onDidChangeTextDocument: () => ({ dispose: () => {} }),
};

export class RelativePattern {
  constructor(public base: string, public pattern: string) {}
}

export const window = {
  createTextEditorDecorationType: (_options: any) => ({
    dispose: () => {},
  }),
  createStatusBarItem: (_alignment?: StatusBarAlignment, _priority?: number) => ({
    text: '',
    tooltip: '',
    command: '',
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  onDidChangeActiveTextEditor: (_cb: any) => ({ dispose: () => {} }),
  onDidChangeVisibleTextEditors: (_cb: any) => ({ dispose: () => {} }),
  get activeTextEditor() { return undefined as any; },
  get visibleTextEditors() { return [] as any[]; },
  showQuickPick: async () => undefined as any,
  showInputBox: async () => undefined as any,
  showInformationMessage: async () => undefined as any,
  showWarningMessage: async () => undefined as any,
  showErrorMessage: async () => undefined as any,
  withProgress: async () => undefined as any,
};

export const commands = {
  registerCommand: (_id: string, _handler: any) => ({ dispose: () => {} }),
  executeCommand: async () => undefined as any,
};

export const lm = {
  selectChatModels: async () => [] as any[],
};

export class LanguageModelError extends Error {
  constructor(message: string) { super(message); }
}

export const LanguageModelChatMessage = {
  User: (content: string) => ({ role: 'user', content }),
};
