import * as vscode from 'vscode';
import { DiaryStore } from '../storage/diaryStore';
import { EPHEMERAL_CATEGORIES } from '../models/annotation';
import { getRelativePath, getWorkspaceCwd, gitDiff, parseChangedLineRanges } from '../utils/git';
import { rangesOverlap } from '../views/preCommitBriefProvider';

/**
 * Proactive notifications when a developer opens or modifies a file
 * that has relevant knowledge (critical flags, annotations).
 *
 * - On file open: if the file has unresolved critical flags, show a warning.
 * - On file save: if uncommitted changes overlap known annotations or critical
 *   flags, nudge the developer toward the Pre-Commit Brief.
 */
export class KnowledgeNotifier implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  // Track which files we've already notified about to avoid spamming
  private notifiedOnOpen = new Set<string>();
  private notifiedOnSave = new Set<string>();

  constructor(private store: DiaryStore) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) { this.onFileOpened(editor); }
      }),
      vscode.workspace.onDidSaveTextDocument(doc => {
        this.onFileSaved(doc);
      }),
      // Reset notifications when store changes (new annotations added)
      store.onDidChange(() => {
        this.notifiedOnOpen.clear();
        this.notifiedOnSave.clear();
      }),
    );
  }

  private onFileOpened(editor: vscode.TextEditor): void {
    const filePath = getRelativePath(editor.document.uri);
    if (!filePath) { return; }
    if (this.notifiedOnOpen.has(filePath)) { return; }

    const criticalFlags = this.store.getCriticalFlagsForFile(filePath);
    const unresolved = criticalFlags.filter(f => !f.human_reviewed);

    if (unresolved.length === 0) { return; }

    this.notifiedOnOpen.add(filePath);

    const highest = unresolved.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2 };
      return order[a.severity] - order[b.severity];
    })[0];

    const message = unresolved.length === 1
      ? `CodeDiary: This file has a ${highest.severity} critical flag — ${highest.description || 'no description'}`
      : `CodeDiary: This file has ${unresolved.length} unresolved critical flags (highest: ${highest.severity})`;

    vscode.window.showWarningMessage(message, 'Show Brief', 'Dismiss').then(choice => {
      if (choice === 'Show Brief') {
        vscode.commands.executeCommand('codediary.preCommitBrief.focus');
      }
    });
  }

  private onFileSaved(doc: vscode.TextDocument): void {
    const filePath = getRelativePath(doc.uri);
    if (!filePath) { return; }
    if (this.notifiedOnSave.has(filePath)) { return; }

    const cwd = getWorkspaceCwd();
    if (!cwd) { return; }

    // Check if this file has uncommitted changes
    const diff = gitDiff(filePath, cwd);
    if (!diff) { return; }

    const changedRanges = parseChangedLineRanges(diff);
    if (changedRanges.length === 0) { return; }

    // Check for overlapping knowledge
    const annotations = this.store.getAnnotationsForFile(filePath)
      .filter(a => !EPHEMERAL_CATEGORIES.has(a.category));
    const criticalFlags = this.store.getCriticalFlagsForFile(filePath);

    const overlappingAnnotations = annotations.filter(a =>
      rangesOverlap(a.line_start, a.line_end, changedRanges),
    );
    const overlappingCritical = criticalFlags.filter(f =>
      rangesOverlap(f.line_start, f.line_end, changedRanges),
    );

    const total = overlappingAnnotations.length + overlappingCritical.length;
    if (total === 0) { return; }

    this.notifiedOnSave.add(filePath);

    const parts: string[] = [];
    if (overlappingCritical.length > 0) {
      const unresolvedCount = overlappingCritical.filter(f => !f.human_reviewed).length;
      if (unresolvedCount > 0) {
        parts.push(`${unresolvedCount} critical flag${unresolvedCount !== 1 ? 's' : ''}`);
      }
    }
    if (overlappingAnnotations.length > 0) {
      parts.push(`${overlappingAnnotations.length} annotation${overlappingAnnotations.length !== 1 ? 's' : ''}`);
    }

    const message = `CodeDiary: Your changes overlap ${parts.join(' and ')} — review before committing`;

    vscode.window.showInformationMessage(message, 'Show Brief', 'Dismiss').then(choice => {
      if (choice === 'Show Brief') {
        vscode.commands.executeCommand('codediary.preCommitBrief.focus');
      }
    });
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
