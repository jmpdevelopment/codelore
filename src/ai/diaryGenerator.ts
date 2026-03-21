import * as vscode from 'vscode';
import { LmService } from './lmService';
import { DiaryStore } from '../storage/diaryStore';
import { Annotation, AnnotationCategory } from '../models/annotation';
import { v4 as uuidv4 } from 'uuid';

const SYSTEM_PROMPT = `You are CodeDiary, an assistant that helps developers journal their AI-assisted code changes.

Given a code diff, generate structured diary entries that capture:
1. What changed and why it likely changed
2. What the developer should verify or pay attention to
3. Any potential risks or concerns

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

function getGitUser(): string {
  try {
    const cp = require('child_process');
    return cp.execSync('git config user.name', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export class DiaryGenerator {
  constructor(
    private lm: LmService,
    private store: DiaryStore,
  ) {}

  async suggestForFile(editor: vscode.TextEditor): Promise<void> {
    const filePath = this.getRelativePath(editor.document.uri);
    if (!filePath) { return; }

    const diff = await this.getGitDiff(filePath);
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
        progress.report({ message: 'Connecting to language model...' });

        const prompt = `File: ${filePath}\n\nDiff:\n${diff}\n\nCurrent file content (for line reference):\n${this.numberLines(fileContent)}`;
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
      },
    );
  }

  async suggestForAllChanges(): Promise<void> {
    const diff = await this.getGitDiffAll();
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
        progress.report({ message: 'Connecting to language model...' });

        const prompt = `Full diff of all uncommitted changes:\n\n${diff}`;
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
          const file = (entry as any).file || 'unknown';
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
      },
    );
  }

  private async presentSuggestions(filePath: string, entries: SuggestedEntry[], modelName: string): Promise<void> {
    // Show quick pick with all suggestions, let user accept/dismiss each
    const items = entries.map((entry) => ({
      label: `${entry.text.substring(0, 70)}`,
      description: `L${entry.line_start}-${entry.line_end} · ${entry.category}`,
      picked: true,
      entry,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Select diary entries to keep (uncheck to dismiss)',
      title: `${entries.length} suggested entries for ${filePath} — ${modelName}`,
    });

    if (!selected || selected.length === 0) { return; }

    for (const item of selected) {
      this.addAsSuggested(filePath, item.entry);
    }

    vscode.window.showInformationMessage(
      `CodeDiary: ${selected.length} diary entries added.`,
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
      // Strip markdown fences if present
      const cleaned = raw.replace(/^```(?:json)?\n?/gm, '').replace(/\n?```$/gm, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) { return []; }
      return parsed.filter(
        (e: any) => e.category && e.line_start && e.text,
      );
    } catch {
      return [];
    }
  }

  private parseEntriesWithFile(raw: string): (SuggestedEntry & { file?: string })[] {
    return this.parseEntries(raw);
  }

  private async getGitDiff(filePath: string): Promise<string | undefined> {
    try {
      const cp = require('child_process');
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!cwd) { return undefined; }
      const diff = cp.execSync(`git diff HEAD -- "${filePath}"`, { cwd, encoding: 'utf8' });
      // If no diff against HEAD, try unstaged
      if (!diff.trim()) {
        const unstaged = cp.execSync(`git diff -- "${filePath}"`, { cwd, encoding: 'utf8' });
        return unstaged.trim() || undefined;
      }
      return diff.trim();
    } catch {
      return undefined;
    }
  }

  private async getGitDiffAll(): Promise<string | undefined> {
    try {
      const cp = require('child_process');
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!cwd) { return undefined; }
      // Both staged and unstaged
      const diff = cp.execSync('git diff HEAD', { cwd, encoding: 'utf8' });
      return diff.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private numberLines(content: string): string {
    return content
      .split('\n')
      .map((line, i) => `${i + 1}: ${line}`)
      .join('\n');
  }

  private getRelativePath(uri: vscode.Uri): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) { return undefined; }
    return vscode.workspace.asRelativePath(uri, false);
  }
}
