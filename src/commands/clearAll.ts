import * as vscode from 'vscode';
import { LoreStore } from '../storage/loreStore';

export function registerExportCommands(context: vscode.ExtensionContext, store: LoreStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codelore.clearAll', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all personal CodeLore annotations and critical flags? (Team data in .codelore/ is not affected.)',
        { modal: true },
        'Clear Personal Data',
      );
      if (confirm === 'Clear Personal Data') {
        store.clearAll();
        vscode.window.showInformationMessage('CodeLore: Personal data cleared');
      }
    }),
  );
}
