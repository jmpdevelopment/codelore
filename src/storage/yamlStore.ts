import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as fs from 'fs';
import { Annotation } from '../models/annotation';
import { ReviewMarker } from '../models/reviewMarker';
import { CriticalFlag } from '../models/criticalFlag';

export interface DiaryData {
  narrative?: string;
  annotations: Annotation[];
  review_markers: ReviewMarker[];
  critical_flags: CriticalFlag[];
}

const EMPTY_DATA: DiaryData = {
  annotations: [],
  review_markers: [],
  critical_flags: [],
};

export class YamlStore {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private data: DiaryData = { ...EMPTY_DATA, annotations: [], review_markers: [], critical_flags: [] };
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
    this.filePath = path.join(workspaceFolder.uri.fsPath, relative);
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
      this.data = { annotations: [], review_markers: [], critical_flags: [] };
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = yaml.load(raw) as Partial<DiaryData> | null;
      this.data = {
        narrative: parsed?.narrative,
        annotations: parsed?.annotations ?? [],
        review_markers: parsed?.review_markers ?? [],
        critical_flags: parsed?.critical_flags ?? [],
      };
    } catch {
      this.data = { annotations: [], review_markers: [], critical_flags: [] };
    }
  }

  save(): void {
    if (!this.filePath) { return; }
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = yaml.dump(this.data, { lineWidth: 120, noRefs: true });
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

  // --- Review Markers ---

  getReviewMarkers(): ReviewMarker[] {
    return this.data.review_markers;
  }

  getReviewMarkersForFile(file: string): ReviewMarker[] {
    return this.data.review_markers.filter(m => m.file === file);
  }

  addReviewMarker(marker: ReviewMarker): void {
    // Merge overlapping ranges for same file
    const existing = this.data.review_markers.filter(m => m.file === marker.file);
    const nonOverlapping = existing.filter(
      m => m.line_end < marker.line_start || m.line_start > marker.line_end,
    );
    const overlapping = existing.filter(
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

    this.data.review_markers = [
      ...this.data.review_markers.filter(m => m.file !== marker.file),
      ...nonOverlapping,
      merged,
    ];
    this.save();
    this._onDidChange.fire();
  }

  removeReviewMarker(file: string, lineStart: number, lineEnd: number): void {
    this.data.review_markers = this.data.review_markers.filter(
      m => !(m.file === file && m.line_start === lineStart && m.line_end === lineEnd),
    );
    this.save();
    this._onDidChange.fire();
  }

  removeReviewMarkersForFile(file: string): void {
    this.data.review_markers = this.data.review_markers.filter(m => m.file !== file);
    this.save();
    this._onDidChange.fire();
  }

  isLineReviewed(file: string, line: number): boolean {
    return this.data.review_markers.some(
      m => m.file === file && line >= m.line_start && line <= m.line_end,
    );
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
    this.data = { annotations: [], review_markers: [], critical_flags: [] };
    this.save();
    this._onDidChange.fire();
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }
}
