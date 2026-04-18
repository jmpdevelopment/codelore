import * as vscode from 'vscode';
import { LoreStore } from '../storage/loreStore';
import { CriticalFlag, CriticalSeverity } from '../models/criticalFlag';
import { getGitUser, getRelativePath } from '../utils/git';
import { computeContentHash, computeSignatureHash } from '../utils/anchorEngine';
import { pickScope } from './scopePicker';

export function registerCriticalCommands(context: vscode.ExtensionContext, store: LoreStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codelore.markCritical', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const selection = editor.selection;
      const lineStart = selection.start.line + 1;
      const lineEnd = selection.end.line + 1;

      const severityPick = await vscode.window.showQuickPick(
        [
          { label: '$(error) Critical', description: 'Must be reviewed before shipping', severity: 'critical' as CriticalSeverity },
          { label: '$(warning) High', description: 'Should be reviewed carefully', severity: 'high' as CriticalSeverity },
          { label: '$(info) Medium', description: 'Worth a second look', severity: 'medium' as CriticalSeverity },
        ],
        { placeHolder: 'Select severity level' },
      );
      if (!severityPick) { return; }

      const description = await vscode.window.showInputBox({
        prompt: 'Why is this critical? (optional)',
        placeHolder: 'e.g., "Payment logic — verify amount calculation"',
      });

      // Check for overlapping critical flags
      const overlapping = store.findOverlappingCriticalFlags(filePath, lineStart, lineEnd);
      if (overlapping.length > 0) {
        const overlapItems = [
          { label: '$(add) Keep both', id: 'keep' as const },
          { label: '$(replace) Replace existing', id: 'replace' as const },
          { label: '$(close) Cancel', id: 'cancel' as const },
        ];
        const choice = await vscode.window.showQuickPick(overlapItems, {
          placeHolder: `${overlapping.length} existing critical flag(s) overlap this range. What do you want to do?`,
        });
        if (!choice || choice.id === 'cancel') { return; }
        if (choice.id === 'replace') {
          for (const f of overlapping) {
            store.removeCriticalFlag(filePath, f.line_start, f.line_end);
          }
        }
      }

      const scope = await pickScope(store);
      if (!scope) { return; }

      // Compute content anchor from current file content
      const fileLines = editor.document.getText().split('\n');
      const contentHash = computeContentHash(fileLines, lineStart, lineEnd);
      const signatureHash = computeSignatureHash(fileLines, lineStart, lineEnd);

      const flag: CriticalFlag = {
        file: filePath,
        line_start: lineStart,
        line_end: lineEnd,
        severity: severityPick.severity,
        description: description || undefined,
        human_reviewed: false,
        anchor: { content_hash: contentHash, signature_hash: signatureHash, stale: false },
      };

      store.addCriticalFlag(flag, scope);
      const scopeLabel = scope === 'shared' ? 'team' : 'working notes';
      vscode.window.showInformationMessage(
        `CodeLore: Lines ${lineStart}-${lineEnd} marked as ${severityPick.severity} (${scopeLabel})`,
      );
    }),

    vscode.commands.registerCommand('codelore.resolveCritical', async (file?: string, lineStart?: number) => {
      // Can be called from sidebar (with args) or from cursor
      if (!file || lineStart === undefined) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        file = getRelativePath(editor.document.uri);
        if (!file) { return; }
        const line = editor.selection.active.line + 1;
        const flags = store.getCriticalFlagsForFile(file)
          .filter(f => line >= f.line_start && line <= f.line_end);
        if (flags.length === 0) {
          vscode.window.showInformationMessage('CodeLore: No critical flag at cursor.');
          return;
        }
        if (flags.length === 1) {
          lineStart = flags[0].line_start;
        } else {
          const pick = await vscode.window.showQuickPick(
            flags.map(f => ({
              label: `${f.severity}: ${f.description || 'No description'}`,
              description: `L${f.line_start}-${f.line_end}`,
              lineStart: f.line_start,
            })),
            { placeHolder: 'Select which critical flag to resolve' },
          );
          if (!pick) { return; }
          lineStart = pick.lineStart;
        }
      }

      const comment = await vscode.window.showInputBox({
        prompt: 'Resolution comment — why is this resolved or not an issue?',
        placeHolder: 'e.g., "Verified the auth check covers all roles" or "False positive — this is test code"',
      });
      if (comment === undefined) { return; }

      store.updateCriticalFlag(file, lineStart, {
        human_reviewed: true,
        resolved_by: getGitUser(),
        resolved_at: new Date().toISOString(),
        resolution_comment: comment || undefined,
      });

      vscode.window.showInformationMessage('CodeLore: Critical flag resolved');
    }),

    vscode.commands.registerCommand('codelore.removeCritical', async (file?: string, lineStart?: number, lineEnd?: number) => {
      if (!file || lineStart === undefined || lineEnd === undefined) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        file = getRelativePath(editor.document.uri);
        if (!file) { return; }
        const line = editor.selection.active.line + 1;
        const flags = store.getCriticalFlagsForFile(file)
          .filter(f => line >= f.line_start && line <= f.line_end);
        if (flags.length === 0) {
          vscode.window.showInformationMessage('CodeLore: No critical flag at cursor.');
          return;
        }
        if (flags.length === 1) {
          lineStart = flags[0].line_start;
          lineEnd = flags[0].line_end;
        } else {
          const pick = await vscode.window.showQuickPick(
            flags.map(f => ({
              label: `${f.severity}: ${f.description || 'No description'}`,
              description: `L${f.line_start}-${f.line_end}`,
              flag: f,
            })),
            { placeHolder: 'Select which critical flag to remove' },
          );
          if (!pick) { return; }
          lineStart = pick.flag.line_start;
          lineEnd = pick.flag.line_end;
        }
      }

      store.removeCriticalFlag(file, lineStart, lineEnd);
      vscode.window.showInformationMessage('CodeLore: Critical flag removed');
    }),
  );
}
