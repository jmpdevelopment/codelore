// Lightweight vscode mock for unit testing.
// Only implements what CodeLore actually uses.

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

export enum QuickPickItemKind {
  Default = 0,
  Separator = -1,
}

// --- Configurable workspace mock ---

let _workspaceFolders: { uri: Uri; name: string; index: number }[] | undefined;
let _configValues: Record<string, any> = {};
let _activeTextEditor: any = undefined;
let _commands = new Map<string, (...args: any[]) => any>();
let _quickPickQueue: any[] = [];
let _inputBoxQueue: any[] = [];
let _executedCommands: Array<{ id: string; args: any[] }> = [];
let _findFilesResult: Uri[] = [];

/** Test helper: set the mock workspace folder */
export function __setWorkspaceFolder(fsPath: string): void {
  _workspaceFolders = [{ uri: Uri.file(fsPath), name: 'test', index: 0 }];
}

/** Test helper: clear workspace */
export function __clearWorkspace(): void {
  _workspaceFolders = undefined;
  _activeTextEditor = undefined;
  _commands = new Map();
  _quickPickQueue = [];
  _inputBoxQueue = [];
  _executedCommands = [];
  _findFilesResult = [];
}

/** Test helper: set the mock result returned from `workspace.findFiles`. */
export function __setFindFilesResult(paths: string[]): void {
  _findFilesResult = paths.map(p => Uri.file(p));
}

/** Test helper: set config values */
export function __setConfig(values: Record<string, any>): void {
  _configValues = values;
}

/** Test helper: set the active text editor (provide a fake editor object or undefined) */
export function __setActiveTextEditor(editor: any): void {
  _activeTextEditor = editor;
}

/**
 * Test helper: queue responses for `window.showQuickPick` calls. Each call
 * shifts one value from the queue; if the queue is empty, returns undefined.
 */
export function __queueQuickPick(...responses: any[]): void {
  _quickPickQueue.push(...responses);
}

/**
 * Test helper: queue responses for `window.showInputBox` calls. Each call
 * shifts one value from the queue; if the queue is empty, returns undefined.
 */
export function __queueInputBox(...responses: any[]): void {
  _inputBoxQueue.push(...responses);
}

/** Test helper: reset the quick pick and input box queues + command log. */
export function __resetPrompts(): void {
  _quickPickQueue = [];
  _inputBoxQueue = [];
  _executedCommands = [];
}

/** Test helper: returns all calls to commands.executeCommand in order. */
export function __getExecutedCommands(): Array<{ id: string; args: any[] }> {
  return _executedCommands;
}

export const workspace = {
  get workspaceFolders() { return _workspaceFolders; },
  getWorkspaceFolder(uri: Uri) {
    if (!_workspaceFolders) return undefined;
    const base = _workspaceFolders[0].uri.fsPath;
    const target = typeof uri === 'string' ? uri : uri.fsPath;
    return target === base || target.startsWith(base + '/') || target.startsWith(base + '\\')
      ? _workspaceFolders[0]
      : undefined;
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
  findFiles: async (_include: any, _exclude?: any, maxResults?: number) => {
    if (maxResults !== undefined && _findFilesResult.length > maxResults) {
      return _findFilesResult.slice(0, maxResults);
    }
    return _findFilesResult;
  },
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
    tooltip: '' as any,
    command: '',
    visible: false,
    show() { this.visible = true; },
    hide() { this.visible = false; },
    dispose: () => {},
  }),
  onDidChangeActiveTextEditor: (_cb: any) => ({ dispose: () => {} }),
  onDidChangeVisibleTextEditors: (_cb: any) => ({ dispose: () => {} }),
  get activeTextEditor() { return _activeTextEditor; },
  get visibleTextEditors() { return [] as any[]; },
  showQuickPick: async () => (_quickPickQueue.length > 0 ? _quickPickQueue.shift() : undefined) as any,
  showInputBox: async () => (_inputBoxQueue.length > 0 ? _inputBoxQueue.shift() : undefined) as any,
  showInformationMessage: async () => undefined as any,
  showWarningMessage: async () => undefined as any,
  showErrorMessage: async () => undefined as any,
  withProgress: async (_options: any, task: (progress: any, token: any) => any) => {
    const progress = { report: (_v: any) => {} };
    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) };
    return await task(progress, token);
  },
};

export const commands = {
  registerCommand: (id: string, handler: (...args: any[]) => any) => {
    _commands.set(id, handler);
    return { dispose: () => { _commands.delete(id); } };
  },
  executeCommand: async (id: string, ...args: any[]) => {
    _executedCommands.push({ id, args });
    const handler = _commands.get(id);
    return handler ? await handler(...args) : undefined;
  },
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
