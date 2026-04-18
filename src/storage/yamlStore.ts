import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as fs from 'fs';
import { Annotation, coerceSource } from '../models/annotation';
import { CriticalFlag } from '../models/criticalFlag';
import { SCHEMA_VERSION, assertSupportedVersion } from './schema';

export interface DiaryData {
  narrative?: string;
  annotations: Annotation[];
  critical_flags: CriticalFlag[];
}

const EMPTY_DATA: DiaryData = {
  annotations: [],
  critical_flags: [],
};

export class YamlStore {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private data: DiaryData = { ...EMPTY_DATA, annotations: [], critical_flags: [] };
  private filePath: string | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor() {
    this.resolveFilePath();
    this.load();
    this.setupWatcher();
  }

  private resolveFilePath(): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }
    const config = vscode.workspace.getConfiguration('codediary');
    const relative = config.get<string>('storagePath', '.vscode/codediary.yaml');
    const resolved = path.resolve(workspaceFolder.uri.fsPath, relative);
    // Prevent path traversal outside workspace
    if (!resolved.startsWith(workspaceFolder.uri.fsPath + path.sep)) {
      return;
    }
    // Resolve symlinks to prevent writing outside workspace via symlink
    try {
      const realWorkspace = fs.realpathSync(workspaceFolder.uri.fsPath);
      const dir = path.dirname(resolved);
      if (fs.existsSync(dir)) {
        const realDir = fs.realpathSync(dir);
        if (!realDir.startsWith(realWorkspace + path.sep) && realDir !== realWorkspace) {
          return;
        }
      }
    } catch { /* directory doesn't exist yet — will be created, no symlink risk */ }
    this.filePath = resolved;
  }

  private setupWatcher(): void {
    if (!this.filePath) { return; }
    const pattern = new vscode.RelativePattern(
      path.dirname(this.filePath),
      path.basename(this.filePath),
    );
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidChange(() => {
      this.load();
      this._onDidChange.fire();
    });
  }

  load(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      this.data = { annotations: [], critical_flags: [] };
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = yaml.load(raw) as Partial<DiaryData> | null;
      assertSupportedVersion(parsed, this.filePath);
      this.data = {
        narrative: parsed?.narrative,
        annotations: (parsed?.annotations ?? []).map(a => ({ ...a, source: coerceSource(a.source) })),
        critical_flags: parsed?.critical_flags ?? [],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`CodeDiary: ${message}`);
      this.data = { annotations: [], critical_flags: [] };
    }
  }

  save(): void {
    if (!this.filePath) { return; }
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Re-check symlink safety before writing
    try {
      const realPath = fs.realpathSync(dir);
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (wsFolder) {
        const realWorkspace = fs.realpathSync(wsFolder.uri.fsPath);
        if (!realPath.startsWith(realWorkspace + path.sep) && realPath !== realWorkspace) {
          return;
        }
      }
    } catch { return; }
    const payload = { version: SCHEMA_VERSION, ...this.data };
    const content = yaml.dump(payload, { lineWidth: 120, noRefs: true });
    fs.writeFileSync(this.filePath, content, 'utf8');
  }

  // --- Narrative ---

  getNarrative(): string | undefined {
    return this.data.narrative;
  }

  setNarrative(text: string): void {
    this.data.narrative = text;
    this.save();
    this._onDidChange.fire();
  }

  // --- Annotations ---

  getAnnotations(): Annotation[] {
    return this.data.annotations;
  }

  getAnnotationsForFile(file: string): Annotation[] {
    return this.data.annotations.filter(a => a.file === file);
  }

  addAnnotation(annotation: Annotation): void {
    this.data.annotations.push(annotation);
    this.save();
    this._onDidChange.fire();
  }

  updateAnnotation(id: string, updates: Partial<Annotation>): void {
    const idx = this.data.annotations.findIndex(a => a.id === id);
    if (idx >= 0) {
      this.data.annotations[idx] = { ...this.data.annotations[idx], ...updates };
      this.save();
      this._onDidChange.fire();
    }
  }

  deleteAnnotation(id: string): void {
    this.data.annotations = this.data.annotations.filter(a => a.id !== id);
    this.save();
    this._onDidChange.fire();
  }

  // --- Critical Flags ---

  getCriticalFlags(): CriticalFlag[] {
    return this.data.critical_flags;
  }

  getCriticalFlagsForFile(file: string): CriticalFlag[] {
    return this.data.critical_flags.filter(f => f.file === file);
  }

  addCriticalFlag(flag: CriticalFlag): void {
    this.data.critical_flags.push(flag);
    this.save();
    this._onDidChange.fire();
  }

  updateCriticalFlag(file: string, lineStart: number, updates: Partial<CriticalFlag>): void {
    const idx = this.data.critical_flags.findIndex(
      f => f.file === file && f.line_start === lineStart,
    );
    if (idx >= 0) {
      this.data.critical_flags[idx] = { ...this.data.critical_flags[idx], ...updates };
      this.save();
      this._onDidChange.fire();
    }
  }

  removeCriticalFlag(file: string, lineStart: number, lineEnd: number): void {
    this.data.critical_flags = this.data.critical_flags.filter(
      f => !(f.file === file && f.line_start === lineStart && f.line_end === lineEnd),
    );
    this.save();
    this._onDidChange.fire();
  }

  // --- Bulk ---

  clearAll(): void {
    this.data = { annotations: [], critical_flags: [] };
    this.save();
    this._onDidChange.fire();
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }
}
