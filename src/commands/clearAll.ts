import * as vscode from 'vscode';
import { DiaryStore } from '../storage/diaryStore';

export function registerExportCommands(context: vscode.ExtensionContext, store: DiaryStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.clearAll', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all personal CodeDiary annotations and critical flags? (Team data in .codediary/ is not affected.)',
        { modal: true },
        'Clear Personal Data',
      );
      if (confirm === 'Clear Personal Data') {
        store.clearAll();
        vscode.window.showInformationMessage('CodeDiary: Personal data cleared');
      }
    }),
  );
}
