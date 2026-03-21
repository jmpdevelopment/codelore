import * as vscode from 'vscode';
import { LmService } from './lmService';
import { DiaryStore } from '../storage/diaryStore';
import { Annotation, AnnotationCategory, CATEGORY_META } from '../models/annotation';
import { v4 as uuidv4 } from 'uuid';
import { getGitUser, getRelativePath, getWorkspaceCwd, gitDiff, gitDiffAll } from '../utils/git';
import { validLineRange, isValidCategory } from '../utils/validation';

const SYSTEM_PROMPT = `You are CodeDiary, an assistant that helps developers build institutional knowledge about their codebase during AI-assisted development.

Given a code diff (and any existing annotations/critical flags for this file), generate structured diary entries that capture:
1. What changed and why it likely changed
2. What the developer should verify or pay attention to
3. Any potential risks or concerns

IMPORTANT: If existing annotations or critical flags are provided, use them as context:
- Do NOT duplicate information already captured in existing annotations
- Reference existing knowledge when relevant (e.g., "existing annotation notes an intentional off-by-one here — verify it was preserved")
- Focus new entries on what the existing annotations DON'T already cover

Respond with a JSON array of entries. Each entry has:
- "category": one of "verified", "needs_review", "modified", "confused", "hallucination", "intent", "accepted"
- "line_start": starting line number in the new file
- "line_end": ending line number
- "text": the diary note (1-2 sentences, conversational tone)

Focus on what matters. Skip trivial changes (imports, formatting). Flag anything that looks like it could break things or that a reviewer should double-check.

Respond ONLY with the JSON array, no markdown fences or explanation.`;

interface SuggestedEntry {
  category: AnnotationCategory;
  line_start: number;
  line_end: number;
  text: string;
}

export class DiaryGenerator {
  constructor(
    private lm: LmService,
    private store: DiaryStore,
  ) {}

  async suggestForFile(editor: vscode.TextEditor): Promise<void> {
    const filePath = getRelativePath(editor.document.uri);
    if (!filePath) { return; }

    const cwd = getWorkspaceCwd();
    if (!cwd) { return; }

    const diff = gitDiff(filePath, cwd);
    if (!diff) {
      vscode.window.showInformationMessage('CodeDiary: No changes detected for this file.');
      return;
    }

    const fileContent = editor.document.getText();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `CodeDiary: Generating diary entries for ${filePath}...`,
        cancellable: true,
      },
      async (progress, token) => {
        try {
          progress.report({ message: 'Connecting to language model...' });

          const existingContext = this.formatExistingKnowledge(filePath);
          const prompt = `<file path="${filePath}">\n<diff>\n${diff}\n</diff>\n<content>\n${this.numberLines(fileContent)}\n</content>\n</file>${existingContext}`;
          const result = await this.lm.generate(SYSTEM_PROMPT, prompt, token);
          if (!result || token.isCancellationRequested) { return; }

          progress.report({ message: `Analyzing with ${result.modelName}...` });

          const entries = this.parseEntries(result.text);
          if (entries.length === 0) {
            vscode.window.showInformationMessage(
              `CodeDiary: No diary entries suggested for ${filePath} (via ${result.modelName}).`,
            );
            return;
          }

          await this.presentSuggestions(filePath, entries, result.modelName);
        } catch (err) {
          vscode.window.showErrorMessage(`CodeDiary: Failed to generate diary entries: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    );
  }

  async suggestForAllChanges(): Promise<void> {
    const cwd = getWorkspaceCwd();
    if (!cwd) { return; }

    const diff = gitDiffAll(cwd);
    if (!diff) {
      vscode.window.showInformationMessage('CodeDiary: No uncommitted changes found.');
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'CodeDiary: Generating session diary for all changes...',
        cancellable: true,
      },
      async (progress, token) => {
        try {
          progress.report({ message: 'Connecting to language model...' });

          const prompt = `<diff>\n${diff}\n</diff>`;
          const result = await this.lm.generate(SYSTEM_PROMPT, prompt, token);
          if (!result || token.isCancellationRequested) { return; }

          progress.report({ message: `Analyzing with ${result.modelName}...` });

          const entries = this.parseEntriesWithFile(result.text);
          if (entries.length === 0) {
            vscode.window.showInformationMessage(
              `CodeDiary: No diary entries suggested (via ${result.modelName}).`,
            );
            return;
          }

          // Group by file and present
          const byFile = new Map<string, SuggestedEntry[]>();
          for (const entry of entries) {
            const file = entry.file || 'unknown';
            if (!byFile.has(file)) { byFile.set(file, []); }
            byFile.get(file)!.push(entry);
          }

          let accepted = 0;
          for (const [file, fileEntries] of byFile) {
            for (const entry of fileEntries) {
              this.addAsSuggested(file, entry);
              accepted++;
            }
          }

          vscode.window.showInformationMessage(
            `CodeDiary: ${accepted} diary entries added as suggestions (via ${result.modelName}). Review them in the sidebar.`,
          );
        } catch (err) {
          vscode.window.showErrorMessage(`CodeDiary: Failed to generate diary entries: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    );
  }

  private async presentSuggestions(filePath: string, entries: SuggestedEntry[], modelName: string): Promise<void> {
    // Show quick pick with all suggestions, marking overlaps
    const items = entries.map((entry) => {
      const overlapping = this.store.findOverlapping(filePath, entry.line_start, entry.line_end);
      const overlapNote = overlapping.length > 0
        ? ` (replaces ${overlapping.length} existing)`
        : '';
      return {
        label: `${entry.text.substring(0, 70)}`,
        description: `L${entry.line_start}-${entry.line_end} · ${entry.category}${overlapNote}`,
        picked: overlapping.length === 0, // Don't pre-select entries that would replace existing ones
        entry,
        overlapping,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Select diary entries to keep (uncheck to dismiss). Overlapping entries replace existing.',
      title: `${entries.length} suggested entries for ${filePath} — ${modelName}`,
    });

    if (!selected || selected.length === 0) { return; }

    let added = 0;
    let replaced = 0;
    for (const item of selected) {
      // Remove overlapping AI-generated annotations before adding new one
      for (const existing of item.overlapping) {
        if (existing.source !== 'manual') {
          this.store.deleteAnnotation(existing.id);
          replaced++;
        }
      }
      this.addAsSuggested(filePath, item.entry);
      added++;
    }

    const replaceMsg = replaced > 0 ? ` (replaced ${replaced} older entries)` : '';
    vscode.window.showInformationMessage(
      `CodeDiary: ${added} diary entries added${replaceMsg}.`,
    );
  }

  private addAsSuggested(filePath: string, entry: SuggestedEntry): void {
    const annotation: Annotation = {
      id: uuidv4(),
      file: filePath,
      line_start: entry.line_start,
      line_end: entry.line_end,
      category: entry.category,
      text: entry.text,
      source: 'ai_suggested',
      created_at: new Date().toISOString(),
      author: getGitUser(),
    };
    this.store.addAnnotation(annotation);
  }

  private parseEntries(raw: string): SuggestedEntry[] {
    try {
      const cleaned = raw.replace(/^```(?:json)?\n?/gm, '').replace(/\n?```$/gm, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) { return []; }
      const results: SuggestedEntry[] = [];
      for (const e of parsed) {
        if (!e || typeof e !== 'object') { continue; }
        const range = validLineRange(e.line_start, e.line_end);
        if (!range) { continue; }
        if (!isValidCategory(e.category)) { continue; }
        if (typeof e.text !== 'string' || !e.text.trim()) { continue; }
        results.push({
          category: e.category,
          line_start: range.line_start,
          line_end: range.line_end,
          text: e.text.trim(),
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  private parseEntriesWithFile(raw: string): (SuggestedEntry & { file?: string })[] {
    try {
      const cleaned = raw.replace(/^```(?:json)?\n?/gm, '').replace(/\n?```$/gm, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) { return []; }
      const results: (SuggestedEntry & { file?: string })[] = [];
      for (const e of parsed) {
        if (!e || typeof e !== 'object') { continue; }
        const range = validLineRange(e.line_start, e.line_end);
        if (!range) { continue; }
        if (!isValidCategory(e.category)) { continue; }
        if (typeof e.text !== 'string' || !e.text.trim()) { continue; }
        results.push({
          category: e.category,
          line_start: range.line_start,
          line_end: range.line_end,
          text: e.text.trim(),
          file: typeof e.file === 'string' ? e.file : undefined,
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  formatExistingKnowledge(filePath: string): string {
    // Only include shared annotations in AI context — personal notes stay private
    const annotations = this.store.shared.getAnnotationsForFile(filePath);
    const criticalFlags = this.store.shared.getCriticalFlagsForFile(filePath);

    if (annotations.length === 0 && criticalFlags.length === 0) {
      return '';
    }

    const parts: string[] = ['\n\n<existing_knowledge>'];

    if (annotations.length > 0) {
      parts.push('Existing annotations for this file:');
      for (const a of annotations) {
        parts.push(`- L${a.line_start}-${a.line_end} [${CATEGORY_META[a.category].label}]: ${a.text}`);
      }
    }

    if (criticalFlags.length > 0) {
      parts.push('Existing critical flags for this file:');
      for (const f of criticalFlags) {
        const status = f.human_reviewed ? 'reviewed' : 'unreviewed';
        parts.push(`- L${f.line_start}-${f.line_end} [${f.severity}, ${status}]: ${f.description || 'No description'}`);
      }
    }

    parts.push('</existing_knowledge>');
    return parts.join('\n');
  }

  private numberLines(content: string): string {
    return content
      .split('\n')
      .map((line, i) => `${i + 1}: ${line}`)
      .join('\n');
  }
}
