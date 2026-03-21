import * as vscode from 'vscode';
import { YamlStore } from '../storage/yamlStore';
import { ReviewMarker } from '../models/reviewMarker';

function getGitUser(): string {
  try {
    const cp = require('child_process');
    return cp.execSync('git config user.name', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getRelativePath(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) { return undefined; }
  return vscode.workspace.asRelativePath(uri, false);
}

export function registerReviewCommands(context: vscode.ExtensionContext, store: YamlStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.markReviewed', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

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

      store.addReviewMarker(marker);

      const lineCount = lineEnd - lineStart + 1;
      vscode.window.showInformationMessage(
        `CodeDiary: Marked ${lineCount} line${lineCount > 1 ? 's' : ''} as reviewed`,
      );
    }),

    vscode.commands.registerCommand('codediary.markFileReviewed', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const lineCount = editor.document.lineCount;
      const marker: ReviewMarker = {
        file: filePath,
        line_start: 1,
        line_end: lineCount,
        reviewer: getGitUser(),
        reviewed_at: new Date().toISOString(),
      };

      store.addReviewMarker(marker);
      vscode.window.showInformationMessage(
        `CodeDiary: Marked entire file as reviewed (${lineCount} lines)`,
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

      // Remove any markers that overlap with the selection
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
