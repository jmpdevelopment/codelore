import * as vscode from 'vscode';
import { YamlStore } from '../storage/yamlStore';
import { CriticalFlag, CriticalSeverity } from '../models/criticalFlag';

function getRelativePath(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) { return undefined; }
  return vscode.workspace.asRelativePath(uri, false);
}

export function registerCriticalCommands(context: vscode.ExtensionContext, store: YamlStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.markCritical', async () => {
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

      const flag: CriticalFlag = {
        file: filePath,
        line_start: lineStart,
        line_end: lineEnd,
        severity: severityPick.severity,
        description: description || undefined,
        human_reviewed: false,
      };

      store.addCriticalFlag(flag);
      vscode.window.showInformationMessage(
        `CodeDiary: Lines ${lineStart}-${lineEnd} marked as ${severityPick.severity}`,
      );
    }),
  );
}
