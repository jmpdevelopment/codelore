import * as vscode from 'vscode';
import { LoreStore } from '../storage/loreStore';
import { getRelativePath } from '../utils/git';

/**
 * Status bar item showing which component(s) the active editor is tagged
 * into. Clicking the item runs `codelore.tagFileComponent` — "Untagged"
 * becomes the primary entry point for first-time tagging and for extending
 * a file into additional components.
 *
 * Hidden when there is no active editor, the editor is not in the workspace,
 * or the workspace has no components defined yet.
 */
export class ComponentBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(private store: LoreStore) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      49,
    );
    this.statusBarItem.command = 'codelore.tagFileComponent';

    this.disposables.push(
      store.onDidChange(() => this.update()),
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
    );

    this.update();
  }

  update(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.statusBarItem.hide();
      return;
    }
    const relPath = getRelativePath(editor.document.uri);
    if (!relPath) {
      this.statusBarItem.hide();
      return;
    }
    if (this.store.getComponents().length === 0) {
      this.statusBarItem.hide();
      return;
    }

    const components = this.store.getComponentsForFile(relPath);

    if (components.length === 0) {
      this.statusBarItem.text = '$(symbol-namespace) Untagged';
      this.statusBarItem.tooltip = new vscode.MarkdownString(
        `**${relPath}** is not tagged into any component.\n\nClick to tag it.`,
      );
    } else {
      const names = components.map(c => c.name);
      const display = names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
      this.statusBarItem.text = `$(symbol-namespace) ${display}`;
      const tip = new vscode.MarkdownString();
      tip.appendMarkdown(`**${relPath}** is tagged into:\n`);
      for (const c of components) {
        tip.appendMarkdown(`- ${c.name} \`${c.id}\`\n`);
      }
      tip.appendMarkdown(`\nClick to add another component or untag.`);
      this.statusBarItem.tooltip = tip;
    }

    this.statusBarItem.show();
  }

  dispose(): void {
    this.statusBarItem.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
