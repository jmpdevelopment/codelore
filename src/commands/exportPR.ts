import * as vscode from 'vscode';
import { YamlStore } from '../storage/yamlStore';
import { generateMarkdown } from '../export/markdownExport';

export function registerExportCommands(context: vscode.ExtensionContext, store: YamlStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.exportPR', async () => {
      const markdown = generateMarkdown(store);
      await vscode.env.clipboard.writeText(markdown);
      vscode.window.showInformationMessage('CodeDiary: PR description copied to clipboard');
    }),

    vscode.commands.registerCommand('codediary.setNarrative', async () => {
      const current = store.getNarrative() || '';
      const text = await vscode.window.showInputBox({
        prompt: 'Change narrative — describe the intent behind these changes',
        value: current,
        placeHolder: 'e.g., "Added OAuth flow with token refresh for the new SSO integration"',
      });
      if (text === undefined) { return; }
      store.setNarrative(text);
      vscode.window.showInformationMessage('CodeDiary: Narrative updated');
    }),

    vscode.commands.registerCommand('codediary.clearAll', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all CodeDiary annotations, review markers, and critical flags?',
        { modal: true },
        'Clear All',
      );
      if (confirm === 'Clear All') {
        store.clearAll();
        vscode.window.showInformationMessage('CodeDiary: All data cleared');
      }
    }),
  );
}
