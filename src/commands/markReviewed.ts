import * as vscode from 'vscode';
import { DiaryStore } from '../storage/diaryStore';
import { ReviewMarker } from '../models/reviewMarker';
import { getGitUser, getRelativePath } from '../utils/git';
import { pickScope } from './scopePicker';

export function registerReviewCommands(context: vscode.ExtensionContext, store: DiaryStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.markReviewed', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const scope = await pickScope(store);
      if (!scope) { return; }

      const selection = editor.selection;
      const lineStart = selection.start.line + 1;
      const lineEnd = selection.end.line + 1;

      const marker: ReviewMarker = {
        file: filePath,
        line_start: lineStart,
        line_end: lineEnd,
        reviewer: getGitUser(),
        reviewed_at: new Date().toISOString(),
      };

      store.addReviewMarker(marker, scope);

      const lineCount = lineEnd - lineStart + 1;
      const scopeLabel = scope === 'shared' ? 'shared' : 'personal';
      vscode.window.showInformationMessage(
        `CodeDiary: Marked ${lineCount} line${lineCount > 1 ? 's' : ''} as reviewed (${scopeLabel})`,
      );
    }),

    vscode.commands.registerCommand('codediary.markFileReviewed', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const scope = await pickScope(store);
      if (!scope) { return; }

      const lineCount = editor.document.lineCount;
      const marker: ReviewMarker = {
        file: filePath,
        line_start: 1,
        line_end: lineCount,
        reviewer: getGitUser(),
        reviewed_at: new Date().toISOString(),
      };

      store.addReviewMarker(marker, scope);
      const scopeLabel = scope === 'shared' ? 'shared' : 'personal';
      vscode.window.showInformationMessage(
        `CodeDiary: Marked entire file as reviewed (${lineCount} lines, ${scopeLabel})`,
      );
    }),

    vscode.commands.registerCommand('codediary.unmarkReviewed', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const selection = editor.selection;
      const lineStart = selection.start.line + 1;
      const lineEnd = selection.end.line + 1;

      // Remove any markers that overlap with the selection (both stores)
      const markers = store.getReviewMarkersForFile(filePath);
      for (const m of markers) {
        if (!(m.line_end < lineStart || m.line_start > lineEnd)) {
          store.removeReviewMarker(filePath, m.line_start, m.line_end);
        }
      }

      vscode.window.showInformationMessage('CodeDiary: Review mark removed');
    }),
  );
}
