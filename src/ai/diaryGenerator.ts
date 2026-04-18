import * as vscode from 'vscode';
import { LmService } from './lmService';
import { DiaryStore } from '../storage/diaryStore';
import { Annotation, AnnotationCategory, CATEGORY_META, FileDependency } from '../models/annotation';
import { Component } from '../models/component';
import { v4 as uuidv4 } from 'uuid';
import { getGitUser, getRelativePath, getWorkspaceCwd, gitDiff, gitDiffAll } from '../utils/git';
import { validLineRange, isValidKnowledgeCategory, isSafeRelativePath, stripJsonFences, truncateText } from '../utils/validation';

/** Validate and extract dependency entries from AI-generated JSON. */
function parseDependencies(raw: unknown): FileDependency[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) { return undefined; }
  const deps: FileDependency[] = [];
  for (const d of raw) {
    if (!d || typeof d !== 'object') { continue; }
    if (typeof d.file !== 'string' || !d.file.trim()) { continue; }
    const file = d.file.trim();
    if (!isSafeRelativePath(file)) { continue; }
    const range = (d.line_start !== undefined || d.line_end !== undefined)
      ? validLineRange(d.line_start, d.line_end)
      : undefined;
    deps.push({
      file,
      relationship: typeof d.relationship === 'string' ? d.relationship.trim() : 'related',
      line_start: range?.line_start,
      line_end: range?.line_end,
    });
  }
  return deps.length > 0 ? deps : undefined;
}

/**
 * Keep only ids that name a real component. Unknown ids from the model are
 * silently dropped — we'd rather a missing tag than a dangling reference.
 */
function parseComponentTags(raw: unknown, knownIds: Set<string>): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) { return undefined; }
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && knownIds.has(v) && !out.includes(v)) { out.push(v); }
  }
  return out.length > 0 ? out : undefined;
}

const SYSTEM_PROMPT = `You are CodeDiary, the primary author of institutional knowledge for this codebase. A human teammate will review your entries afterwards — your job is to write high-signal notes they would otherwise have to reverse-engineer from the diff.

You are given: a file path, a diff, the full file content (line-numbered), any existing annotations and critical flags, and (when available) the component subsystems this file belongs to. Use all of it.

For each thing a future reader will need to know that the code does not already spell out, emit one entry. Aim for a small number of dense notes, not a play-by-play of the diff. Skip trivial formatting, renames, and import churn.

Respond ONLY with a JSON array (no markdown fences, no prose). Each entry has:
- "category": one of "behavior" | "rationale" | "constraint" | "gotcha" | "business_rule" | "performance" | "security" | "human_note"
- "line_start": starting line number in the new file (1-based, from the numbered content)
- "line_end": ending line number
- "text": 1–2 sentences, concrete, written for a teammate who has not seen this diff
- "components": (optional) array of component ids this entry belongs to — use only ids listed under <components> in the prompt; drop the field if none apply
- "dependencies": (optional) array of cross-file coupling links, e.g. [{"file": "src/billing/calc.ts", "relationship": "must stay in sync"}]

Category guide:
- "behavior": non-obvious runtime behavior a reader would otherwise miss
- "rationale": why this was built this way — decisions, rejected alternatives, historical context
- "constraint": invariant, precondition, or postcondition required for correctness
- "gotcha": footgun, counterintuitive quirk, or known hazard — proceed with care
- "business_rule": domain rule / regulatory requirement — don't change without stakeholder sign-off
- "performance": hot path, complexity assumption, benchmark-sensitive region
- "security": trust boundary, auth assumption, sanitization requirement
- "human_note": free-form observation when nothing else fits

Existing knowledge: do NOT duplicate anything already captured in the existing annotations or critical flags. When your entry refines or depends on existing knowledge, reference it ("existing rationale confirms the off-by-one is intentional — preserved in this refactor").

Component tagging: if a file is already tagged into components, default to tagging your entries with the same ids when the entry is scoped to that subsystem's concerns. Tag only the ids you see under <components>.`;

interface SuggestedEntry {
  category: AnnotationCategory;
  line_start: number;
  line_end: number;
  text: string;
  dependencies?: FileDependency[];
  components?: string[];
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
          const componentContext = this.formatComponentContext(filePath);
          const prompt = `<file path="${filePath}">\n<diff>\n${diff}\n</diff>\n<content>\n${this.numberLines(fileContent)}\n</content>\n</file>${componentContext}${existingContext}`;
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

  /**
   * Full-file knowledge scan (no diff required). Use this for unfamiliar code
   * or to backfill institutional knowledge on a file that has never been
   * annotated. Entries are recorded as `source: ai_generated` and surface to
   * the human for verification like any other AI suggestion.
   */
  async scanForKnowledge(editor: vscode.TextEditor): Promise<void> {
    const filePath = getRelativePath(editor.document.uri);
    if (!filePath) { return; }
    const fileContent = editor.document.getText();
    if (!fileContent.trim()) {
      vscode.window.showInformationMessage('CodeDiary: File is empty.');
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `CodeDiary: Scanning ${filePath} for institutional knowledge...`,
        cancellable: true,
      },
      async (progress, token) => {
        try {
          progress.report({ message: 'Connecting to language model...' });

          const existingContext = this.formatExistingKnowledge(filePath);
          const componentContext = this.formatComponentContext(filePath);
          const prompt = `<file path="${filePath}">\n<scope>full-file knowledge scan (no diff) — cover the entire file, not just a changed range</scope>\n<content>\n${this.numberLines(fileContent)}\n</content>\n</file>${componentContext}${existingContext}`;
          const result = await this.lm.generate(SYSTEM_PROMPT, prompt, token);
          if (!result || token.isCancellationRequested) { return; }

          progress.report({ message: `Analyzing with ${result.modelName}...` });

          const entries = this.parseEntries(result.text);
          if (entries.length === 0) {
            vscode.window.showInformationMessage(
              `CodeDiary: No new knowledge surfaced for ${filePath} (via ${result.modelName}).`,
            );
            return;
          }

          await this.presentSuggestions(filePath, entries, result.modelName);
        } catch (err) {
          vscode.window.showErrorMessage(`CodeDiary: Knowledge scan failed: ${err instanceof Error ? err.message : String(err)}`);
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

          const componentContext = this.formatAllComponentsContext();
          const prompt = `<diff>\n${diff}\n</diff>${componentContext}`;
          const result = await this.lm.generate(SYSTEM_PROMPT, prompt, token);
          if (!result || token.isCancellationRequested) { return; }

          progress.report({ message: `Analyzing with ${result.modelName}...` });

          const entries = this.parseEntries(result.text, true);
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
        label: truncateText(entry.text, 70),
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
        if (existing.source !== 'human_authored') {
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
      source: 'ai_generated',
      created_at: new Date().toISOString(),
      author: getGitUser(),
      dependencies: entry.dependencies && entry.dependencies.length > 0 ? entry.dependencies : undefined,
      components: entry.components && entry.components.length > 0 ? entry.components : undefined,
    };
    this.store.addAnnotation(annotation);
  }

  private parseEntries(raw: string, extractFile = false): (SuggestedEntry & { file?: string })[] {
    try {
      const cleaned = stripJsonFences(raw);
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) { return []; }
      const knownComponentIds = new Set(this.store.getComponents().map(c => c.id));
      const results: (SuggestedEntry & { file?: string })[] = [];
      for (const e of parsed) {
        if (!e || typeof e !== 'object') { continue; }
        const range = validLineRange(e.line_start, e.line_end);
        if (!range) { continue; }
        if (!isValidKnowledgeCategory(e.category)) { continue; }
        if (typeof e.text !== 'string' || !e.text.trim()) { continue; }
        results.push({
          category: e.category,
          line_start: range.line_start,
          line_end: range.line_end,
          text: e.text.trim(),
          file: extractFile && typeof e.file === 'string' ? e.file : undefined,
          dependencies: parseDependencies(e.dependencies),
          components: parseComponentTags(e.components, knownComponentIds),
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  /**
   * Per-file component block: lists the components this file is tagged into
   * plus sibling files inside them, so the model can tag new entries with
   * the same component ids. Empty string when the file is untagged.
   */
  formatComponentContext(filePath: string): string {
    const mine = this.store.getComponentsForFile(filePath);
    if (mine.length === 0) { return ''; }
    const lines: string[] = ['\n\n<components>'];
    lines.push('This file is tagged into the following component(s). Tag entries with these ids when relevant.');
    for (const c of mine) {
      lines.push(this.renderComponentBlock(c, filePath));
    }
    lines.push('</components>');
    return lines.join('\n');
  }

  /**
   * Whole-workspace component block for the multi-file flow. Keeps it short:
   * just ids + names + one-line descriptions so the model knows which tags
   * exist without us blasting every file list into the context window.
   */
  formatAllComponentsContext(): string {
    const all = this.store.getComponents();
    if (all.length === 0) { return ''; }
    const lines: string[] = ['\n\n<components>'];
    lines.push('Available component ids (tag entries with any that apply, using the id exactly):');
    for (const c of all) {
      const desc = c.description ? ` — ${c.description}` : '';
      lines.push(`- ${c.id} (${c.name})${desc}`);
    }
    lines.push('</components>');
    return lines.join('\n');
  }

  private renderComponentBlock(component: Component, currentFile: string): string {
    const lines = [`- ${component.id} (${component.name})`];
    if (component.description) { lines.push(`  description: ${component.description}`); }
    const siblings = component.files.filter(f => f !== currentFile).slice(0, 8);
    if (siblings.length > 0) {
      lines.push(`  other files: ${siblings.join(', ')}${component.files.length - 1 > siblings.length ? ', …' : ''}`);
    }
    return lines.join('\n');
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
