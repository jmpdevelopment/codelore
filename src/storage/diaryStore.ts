import * as vscode from 'vscode';
import { Annotation } from '../models/annotation';
import { ReviewMarker } from '../models/reviewMarker';
import { CriticalFlag } from '../models/criticalFlag';
import { YamlStore } from './yamlStore';
import { SharedStore } from './sharedStore';

export type Scope = 'shared' | 'personal';

/**
 * Facade over SharedStore (.codediary/, committed) and YamlStore (.vscode/, personal).
 *
 * All read operations merge both stores. Write operations route to the
 * correct store based on the scope parameter. The default scope is
 * configurable via codediary.defaultScope setting.
 */
export class DiaryStore {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  readonly personal: YamlStore;
  readonly shared: SharedStore;

  constructor() {
    this.personal = new YamlStore();
    this.shared = new SharedStore();

    this.personal.onDidChange(() => this._onDidChange.fire());
    this.shared.onDidChange(() => this._onDidChange.fire());
  }

  getDefaultScope(): Scope {
    const config = vscode.workspace.getConfiguration('codediary');
    return config.get<Scope>('defaultScope', 'shared');
  }

  // --- Narrative (personal only — it's your intent description) ---

  getNarrative(): string | undefined {
    return this.personal.getNarrative();
  }

  setNarrative(text: string): void {
    this.personal.setNarrative(text);
  }

  // --- Annotations (merged reads, routed writes) ---

  getAnnotations(): Annotation[] {
    return [...this.shared.getAnnotations(), ...this.personal.getAnnotations()];
  }

  getAnnotationsForFile(file: string): Annotation[] {
    return [
      ...this.shared.getAnnotationsForFile(file),
      ...this.personal.getAnnotationsForFile(file),
    ];
  }

  addAnnotation(annotation: Annotation, scope?: Scope): void {
    const target = (scope ?? this.getDefaultScope()) === 'shared' ? this.shared : this.personal;
    target.addAnnotation(annotation);
  }

  updateAnnotation(id: string, updates: Partial<Annotation>): void {
    // Try shared first, then personal
    if (this.shared.getAnnotations().some(a => a.id === id)) {
      this.shared.updateAnnotation(id, updates);
    } else {
      this.personal.updateAnnotation(id, updates);
    }
  }

  deleteAnnotation(id: string): void {
    if (this.shared.getAnnotations().some(a => a.id === id)) {
      this.shared.deleteAnnotation(id);
    } else {
      this.personal.deleteAnnotation(id);
    }
  }

  getAnnotationScope(id: string): Scope {
    return this.shared.getAnnotations().some(a => a.id === id) ? 'shared' : 'personal';
  }

  // --- Review Markers (merged reads, routed writes) ---

  getReviewMarkers(): ReviewMarker[] {
    return [...this.shared.getReviewMarkers(), ...this.personal.getReviewMarkers()];
  }

  getReviewMarkersForFile(file: string): ReviewMarker[] {
    return [
      ...this.shared.getReviewMarkersForFile(file),
      ...this.personal.getReviewMarkersForFile(file),
    ];
  }

  addReviewMarker(marker: ReviewMarker, scope?: Scope): void {
    const target = (scope ?? this.getDefaultScope()) === 'shared' ? this.shared : this.personal;
    target.addReviewMarker(marker);
  }

  removeReviewMarker(file: string, lineStart: number, lineEnd: number): void {
    this.shared.removeReviewMarker(file, lineStart, lineEnd);
    this.personal.removeReviewMarker(file, lineStart, lineEnd);
  }

  removeReviewMarkersForFile(file: string): void {
    this.personal.removeReviewMarkersForFile(file);
    // Don't remove shared markers — that affects the whole team
  }

  isLineReviewed(file: string, line: number): boolean {
    return this.shared.isLineReviewed(file, line) || this.personal.isLineReviewed(file, line);
  }

  // --- Critical Flags (merged reads, routed writes) ---

  getCriticalFlags(): CriticalFlag[] {
    return [...this.shared.getCriticalFlags(), ...this.personal.getCriticalFlags()];
  }

  getCriticalFlagsForFile(file: string): CriticalFlag[] {
    return [
      ...this.shared.getCriticalFlagsForFile(file),
      ...this.personal.getCriticalFlagsForFile(file),
    ];
  }

  addCriticalFlag(flag: CriticalFlag, scope?: Scope): void {
    const target = (scope ?? this.getDefaultScope()) === 'shared' ? this.shared : this.personal;
    target.addCriticalFlag(flag);
  }

  updateCriticalFlag(file: string, lineStart: number, updates: Partial<CriticalFlag>): void {
    // Try shared first
    const sharedFlags = this.shared.getCriticalFlagsForFile(file);
    if (sharedFlags.some(f => f.line_start === lineStart)) {
      this.shared.updateCriticalFlag(file, lineStart, updates);
    } else {
      this.personal.updateCriticalFlag(file, lineStart, updates);
    }
  }

  removeCriticalFlag(file: string, lineStart: number, lineEnd: number): void {
    this.shared.removeCriticalFlag(file, lineStart, lineEnd);
    this.personal.removeCriticalFlag(file, lineStart, lineEnd);
  }

  // --- Bulk ---

  clearAll(): void {
    this.personal.clearAll();
    // Don't clear shared — too dangerous for team data
  }

  dispose(): void {
    this.personal.dispose();
    this.shared.dispose();
    this._onDidChange.dispose();
  }
}
