import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { LoreStore } from '../storage/loreStore';
import { Annotation } from '../models/annotation';
import { getGitUser, getRelativePath } from '../utils/git';
import { computeContentHash, computeSignatureHash } from '../utils/anchorEngine';

export function registerQuickNoteCommands(context: vscode.ExtensionContext, store: LoreStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codelore.quickNote', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const selection = editor.selection;
      const lineStart = selection.start.line + 1;
      const lineEnd = selection.end.line + 1;

      const text = await vscode.window.showInputBox({
        prompt: `Quick note for lines ${lineStart}-${lineEnd}`,
        placeHolder: 'Your note about this code...',
      });
      if (text === undefined || text.trim() === '') { return; }

      const fileLines = editor.document.getText().split('\n');
      const contentHash = computeContentHash(fileLines, lineStart, lineEnd);
      const signatureHash = computeSignatureHash(fileLines, lineStart, lineEnd);

      const scope = store.getDefaultScope();
      const annotation: Annotation = {
        id: uuidv4(),
        file: filePath,
        line_start: lineStart,
        line_end: lineEnd,
        category: 'human_note',
        text: text.trim(),
        source: 'human_authored',
        created_at: new Date().toISOString(),
        author: getGitUser(),
        anchor: { content_hash: contentHash, signature_hash: signatureHash, stale: false },
      };

      store.addAnnotation(annotation, scope);
      const scopeLabel = scope === 'shared' ? 'team' : 'personal';
      vscode.window.showInformationMessage(`CodeLore: Note added (${scopeLabel})`);
    }),

    vscode.commands.registerCommand('codelore.copyAnnotationsForFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('CodeLore: Open a file first.');
        return;
      }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const annotations = store.getAnnotationsForFile(filePath);
      const criticalFlags = store.getCriticalFlagsForFile(filePath);

      if (annotations.length === 0 && criticalFlags.length === 0) {
        vscode.window.showInformationMessage('CodeLore: No annotations or critical flags for this file.');
        return;
      }

      const lines: string[] = [];
      lines.push(`# CodeLore annotations for ${filePath}`);
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
        `CodeLore: Copied ${annotations.length} annotation(s) and ${criticalFlags.length} critical flag(s) to clipboard.`,
      );
    }),
  );
}
