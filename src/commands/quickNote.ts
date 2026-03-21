import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { DiaryStore } from '../storage/diaryStore';
import { Annotation } from '../models/annotation';
import { getGitUser, getRelativePath } from '../utils/git';
import { computeContentHash } from '../utils/anchorEngine';

export function registerQuickNoteCommands(context: vscode.ExtensionContext, store: DiaryStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.quickNote', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const selection = editor.selection;
      const lineStart = selection.start.line + 1;
      const lineEnd = selection.end.line + 1;

      const text = await vscode.window.showInputBox({
        prompt: `AI note for lines ${lineStart}-${lineEnd} (ephemeral — excluded from export)`,
        placeHolder: 'Quick note for AI agent...',
      });
      if (text === undefined || text.trim() === '') { return; }

      const fileLines = editor.document.getText().split('\n');
      const contentHash = computeContentHash(fileLines, lineStart, lineEnd);

      const annotation: Annotation = {
        id: uuidv4(),
        file: filePath,
        line_start: lineStart,
        line_end: lineEnd,
        category: 'ai_prompt',
        text: text.trim(),
        source: 'manual',
        created_at: new Date().toISOString(),
        author: getGitUser(),
        anchor: { content_hash: contentHash, stale: false },
      };

      store.addAnnotation(annotation, 'personal');
      vscode.window.showInformationMessage('CodeDiary: AI note added (ephemeral, personal)');
    }),

    vscode.commands.registerCommand('codediary.copyAnnotationsForFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('CodeDiary: Open a file first.');
        return;
      }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const annotations = store.getAnnotationsForFile(filePath);
      const criticalFlags = store.getCriticalFlagsForFile(filePath);

      if (annotations.length === 0 && criticalFlags.length === 0) {
        vscode.window.showInformationMessage('CodeDiary: No annotations or critical flags for this file.');
        return;
      }

      const lines: string[] = [];
      lines.push(`# CodeDiary annotations for ${filePath}`);
      lines.push('');

      if (annotations.length > 0) {
        lines.push('## Annotations');
        for (const ann of annotations) {
          lines.push(`- [L${ann.line_start}-${ann.line_end}] ${ann.category.toUpperCase()}: ${ann.text}`);
        }
        lines.push('');
      }

      if (criticalFlags.length > 0) {
        lines.push('## Critical Flags');
        for (const flag of criticalFlags) {
          const status = flag.human_reviewed ? 'RESOLVED' : 'UNREVIEWED';
          lines.push(`- [L${flag.line_start}-${flag.line_end}] ${flag.severity.toUpperCase()} (${status})${flag.description ? ': ' + flag.description : ''}`);
        }
        lines.push('');
      }

      await vscode.env.clipboard.writeText(lines.join('\n'));
      vscode.window.showInformationMessage(
        `CodeDiary: Copied ${annotations.length} annotation(s) and ${criticalFlags.length} critical flag(s) to clipboard.`,
      );
    }),
  );
}
