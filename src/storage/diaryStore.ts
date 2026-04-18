import * as vscode from 'vscode';
import { Annotation, AnnotationCategory, CATEGORY_META } from '../models/annotation';
import { ReviewMarker } from '../models/reviewMarker';
import { CriticalFlag } from '../models/criticalFlag';
import { Component } from '../models/component';
import { YamlStore } from './yamlStore';
import { SharedStore } from './sharedStore';
import { ComponentStore } from './componentStore';

export type Scope = 'shared' | 'personal';

export interface SearchFilter {
  text?: string;
  category?: AnnotationCategory;
  file?: string;
}

export interface SearchResult {
  type: 'annotation' | 'critical_flag';
  file: string;
  line_start: number;
  line_end: number;
  label: string;
  detail: string;
  scope: Scope;
}

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
  readonly components: ComponentStore;

  /**
   * Lazily-built reverse index: file path → components that list it.
   * Invalidated whenever ComponentStore fires onDidChange. A full rebuild
   * is O(total files across all components), which is cheap at team scale.
   */
  private fileComponentsIndex: Map<string, Component[]> | null = null;

  constructor() {
    this.personal = new YamlStore();
    this.shared = new SharedStore();
    this.components = new ComponentStore();

    this.personal.onDidChange(() => this._onDidChange.fire());
    this.shared.onDidChange(() => this._onDidChange.fire());
    this.components.onDidChange(() => {
      this.fileComponentsIndex = null;
      this._onDidChange.fire();
    });
  }

  // --- Components (facade over ComponentStore + derived file index) ---

  getComponents(): Component[] {
    return this.components.getAll();
  }

  getComponent(id: string): Component | undefined {
    return this.components.get(id);
  }

  /** Components that include the given workspace-relative file path. */
  getComponentsForFile(file: string): Component[] {
    return this.buildFileComponentsIndex().get(file) ?? [];
  }

  /** All files tagged into at least one component — useful for coverage views. */
  getComponentTaggedFiles(): string[] {
    return [...this.buildFileComponentsIndex().keys()];
  }

  private buildFileComponentsIndex(): Map<string, Component[]> {
    if (this.fileComponentsIndex) { return this.fileComponentsIndex; }
    const index = new Map<string, Component[]>();
    for (const component of this.components.getAll()) {
      for (const file of component.files) {
        const existing = index.get(file);
        if (existing) { existing.push(component); }
        else { index.set(file, [component]); }
      }
    }
    this.fileComponentsIndex = index;
    return index;
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

  // --- Overlap Detection ---

  findOverlapping(file: string, lineStart: number, lineEnd: number): Annotation[] {
    return this.getAnnotationsForFile(file).filter(
      a => a.line_end >= lineStart && a.line_start <= lineEnd,
    );
  }

  findOverlappingCriticalFlags(file: string, lineStart: number, lineEnd: number): CriticalFlag[] {
    return this.getCriticalFlagsForFile(file).filter(
      f => f.line_end >= lineStart && f.line_start <= lineEnd,
    );
  }

  // --- Search ---

  search(filter: SearchFilter): SearchResult[] {
    const results: SearchResult[] = [];
    const textLower = filter.text?.toLowerCase();

    const matchesFile = (file: string) =>
      !filter.file || file.includes(filter.file);

    const matchesText = (text: string) =>
      !textLower || text.toLowerCase().includes(textLower);

    // Search annotations
    const addAnnotations = (annotations: Annotation[], scope: Scope) => {
      for (const a of annotations) {
        if (!matchesFile(a.file)) { continue; }
        if (filter.category && a.category !== filter.category) { continue; }
        if (!matchesText(a.text)) { continue; }
        results.push({
          type: 'annotation',
          file: a.file,
          line_start: a.line_start,
          line_end: a.line_end,
          label: `${CATEGORY_META[a.category].icon} ${a.text}`,
          detail: `${a.file}:${a.line_start} · ${CATEGORY_META[a.category].label}${a.author ? ` · ${a.author}` : ''}`,
          scope,
        });
      }
    };

    addAnnotations(this.shared.getAnnotations(), 'shared');
    addAnnotations(this.personal.getAnnotations(), 'personal');

    // Search critical flags (when no category filter, or user explicitly wants them)
    if (!filter.category) {
      const addFlags = (flags: CriticalFlag[], scope: Scope) => {
        for (const f of flags) {
          if (!matchesFile(f.file)) { continue; }
          if (!matchesText(f.description || '')) { continue; }
          const status = f.human_reviewed ? 'resolved' : 'unreviewed';
          results.push({
            type: 'critical_flag',
            file: f.file,
            line_start: f.line_start,
            line_end: f.line_end,
            label: `$(shield) [${f.severity}] ${f.description || 'Critical region'}`,
            detail: `${f.file}:${f.line_start} · ${status}`,
            scope,
          });
        }
      };

      addFlags(this.shared.getCriticalFlags(), 'shared');
      addFlags(this.personal.getCriticalFlags(), 'personal');
    }

    return results;
  }

  // --- Bulk ---

  clearAll(): void {
    this.personal.clearAll();
    // Don't clear shared — too dangerous for team data
  }

  dispose(): void {
    this.personal.dispose();
    this.shared.dispose();
    this.components.dispose();
    this._onDidChange.dispose();
  }
}
