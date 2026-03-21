import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as fs from 'fs';
import { Annotation } from '../models/annotation';
import { ReviewMarker } from '../models/reviewMarker';
import { CriticalFlag } from '../models/criticalFlag';

/**
 * Per-file YAML storage in .codediary/ directory, committed to git.
 *
 * Structure mirrors the source tree:
 *   .codediary/src/auth/middleware.ts.yaml
 *
 * Each file contains annotations, review_markers, and critical_flags
 * for that source file only. This keeps merge conflicts scoped to
 * individual files — two devs rarely annotate the same file at once.
 */

interface FileData {
  annotations?: Annotation[];
  review_markers?: ReviewMarker[];
  critical_flags?: CriticalFlag[];
}

export class SharedStore {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private basePath: string | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private cache = new Map<string, FileData>();

  constructor() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { return; }
    this.basePath = path.join(workspaceFolder.uri.fsPath, '.codediary');
    this.loadAll();
    this.setupWatcher();
  }

  private setupWatcher(): void {
    if (!this.basePath) { return; }
    const pattern = new vscode.RelativePattern(this.basePath, '**/*.yaml');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const reload = () => {
      this.loadAll();
      this._onDidChange.fire();
    };
    this.watcher.onDidChange(reload);
    this.watcher.onDidCreate(reload);
    this.watcher.onDidDelete(reload);
  }

  private yamlPath(sourceFile: string): string {
    return path.join(this.basePath!, `${sourceFile}.yaml`);
  }

  private loadFile(sourceFile: string): FileData {
    if (!this.basePath) { return {}; }
    const filePath = this.yamlPath(sourceFile);
    if (!fs.existsSync(filePath)) { return {}; }
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return (yaml.load(raw) as FileData) || {};
    } catch {
      return {};
    }
  }

  private saveFile(sourceFile: string, data: FileData): void {
    if (!this.basePath) { return; }
    const filePath = this.yamlPath(sourceFile);

    // If empty, remove the file
    const hasData = (data.annotations?.length ?? 0) > 0
      || (data.review_markers?.length ?? 0) > 0
      || (data.critical_flags?.length ?? 0) > 0;

    if (!hasData) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        // Clean up empty parent dirs
        this.cleanEmptyDirs(path.dirname(filePath));
      }
      this.cache.delete(sourceFile);
      return;
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = yaml.dump(data, { lineWidth: 120, noRefs: true });
    fs.writeFileSync(filePath, content, 'utf8');
    this.cache.set(sourceFile, data);
  }

  private cleanEmptyDirs(dir: string): void {
    if (!this.basePath || !dir.startsWith(this.basePath) || dir === this.basePath) { return; }
    try {
      const entries = fs.readdirSync(dir);
      if (entries.length === 0) {
        fs.rmdirSync(dir);
        this.cleanEmptyDirs(path.dirname(dir));
      }
    } catch { /* ignore */ }
  }

  private loadAll(): void {
    this.cache.clear();
    if (!this.basePath || !fs.existsSync(this.basePath)) { return; }
    this.walkDir(this.basePath);
  }

  private walkDir(dir: string): void {
    if (!fs.existsSync(dir)) { return; }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkDir(fullPath);
      } else if (entry.name.endsWith('.yaml')) {
        // Derive source file path: strip basePath and .yaml suffix
        const relative = path.relative(this.basePath!, fullPath);
        const sourceFile = relative.replace(/\.yaml$/, '');
        try {
          const raw = fs.readFileSync(fullPath, 'utf8');
          const data = (yaml.load(raw) as FileData) || {};
          this.cache.set(sourceFile, data);
        } catch { /* skip malformed files */ }
      }
    }
  }

  // --- Annotations ---

  getAnnotations(): Annotation[] {
    const all: Annotation[] = [];
    for (const data of this.cache.values()) {
      if (data.annotations) { all.push(...data.annotations); }
    }
    return all;
  }

  getAnnotationsForFile(file: string): Annotation[] {
    return this.cache.get(file)?.annotations ?? [];
  }

  addAnnotation(annotation: Annotation): void {
    const data = this.loadFile(annotation.file);
    if (!data.annotations) { data.annotations = []; }
    data.annotations.push(annotation);
    this.saveFile(annotation.file, data);
    this._onDidChange.fire();
  }

  updateAnnotation(id: string, updates: Partial<Annotation>): void {
    for (const [file, data] of this.cache) {
      const idx = data.annotations?.findIndex(a => a.id === id) ?? -1;
      if (idx >= 0 && data.annotations) {
        data.annotations[idx] = { ...data.annotations[idx], ...updates };
        this.saveFile(file, data);
        this._onDidChange.fire();
        return;
      }
    }
  }

  deleteAnnotation(id: string): void {
    for (const [file, data] of this.cache) {
      if (!data.annotations) { continue; }
      const before = data.annotations.length;
      data.annotations = data.annotations.filter(a => a.id !== id);
      if (data.annotations.length < before) {
        this.saveFile(file, data);
        this._onDidChange.fire();
        return;
      }
    }
  }

  // --- Review Markers ---

  getReviewMarkers(): ReviewMarker[] {
    const all: ReviewMarker[] = [];
    for (const data of this.cache.values()) {
      if (data.review_markers) { all.push(...data.review_markers); }
    }
    return all;
  }

  getReviewMarkersForFile(file: string): ReviewMarker[] {
    return this.cache.get(file)?.review_markers ?? [];
  }

  addReviewMarker(marker: ReviewMarker): void {
    const data = this.loadFile(marker.file);
    if (!data.review_markers) { data.review_markers = []; }

    // Merge overlapping ranges
    const nonOverlapping = data.review_markers.filter(
      m => m.line_end < marker.line_start || m.line_start > marker.line_end,
    );
    const overlapping = data.review_markers.filter(
      m => !(m.line_end < marker.line_start || m.line_start > marker.line_end),
    );

    let merged = marker;
    for (const o of overlapping) {
      merged = {
        ...merged,
        line_start: Math.min(merged.line_start, o.line_start),
        line_end: Math.max(merged.line_end, o.line_end),
      };
    }

    data.review_markers = [...nonOverlapping, merged];
    this.saveFile(marker.file, data);
    this._onDidChange.fire();
  }

  removeReviewMarker(file: string, lineStart: number, lineEnd: number): void {
    const data = this.loadFile(file);
    if (!data.review_markers) { return; }
    data.review_markers = data.review_markers.filter(
      m => !(m.line_start === lineStart && m.line_end === lineEnd),
    );
    this.saveFile(file, data);
    this._onDidChange.fire();
  }

  // --- Critical Flags ---

  getCriticalFlags(): CriticalFlag[] {
    const all: CriticalFlag[] = [];
    for (const data of this.cache.values()) {
      if (data.critical_flags) { all.push(...data.critical_flags); }
    }
    return all;
  }

  getCriticalFlagsForFile(file: string): CriticalFlag[] {
    return this.cache.get(file)?.critical_flags ?? [];
  }

  addCriticalFlag(flag: CriticalFlag): void {
    const data = this.loadFile(flag.file);
    if (!data.critical_flags) { data.critical_flags = []; }
    data.critical_flags.push(flag);
    this.saveFile(flag.file, data);
    this._onDidChange.fire();
  }

  updateCriticalFlag(file: string, lineStart: number, updates: Partial<CriticalFlag>): void {
    const data = this.loadFile(file);
    if (!data.critical_flags) { return; }
    const idx = data.critical_flags.findIndex(f => f.line_start === lineStart);
    if (idx >= 0) {
      data.critical_flags[idx] = { ...data.critical_flags[idx], ...updates };
      this.saveFile(file, data);
      this._onDidChange.fire();
    }
  }

  removeCriticalFlag(file: string, lineStart: number, lineEnd: number): void {
    const data = this.loadFile(file);
    if (!data.critical_flags) { return; }
    data.critical_flags = data.critical_flags.filter(
      f => !(f.line_start === lineStart && f.line_end === lineEnd),
    );
    this.saveFile(file, data);
    this._onDidChange.fire();
  }

  // --- Queries ---

  getAnnotatedFiles(): string[] {
    return [...this.cache.keys()];
  }

  isLineReviewed(file: string, line: number): boolean {
    const markers = this.getReviewMarkersForFile(file);
    return markers.some(m => line >= m.line_start && line <= m.line_end);
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }
}
