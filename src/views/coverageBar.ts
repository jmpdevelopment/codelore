import * as vscode from 'vscode';
import { LoreStore } from '../storage/loreStore';

export class CoverageBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(private store: LoreStore) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.statusBarItem.command = 'codelore.showChangePlan';
    this.statusBarItem.tooltip = 'CodeLore — Knowledge Coverage';
    this.statusBarItem.show();

    this.disposables.push(
      store.onDidChange(() => this.update()),
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
    );

    this.update();
  }

  update(): void {
    const annotations = this.store.getAnnotations();
    const criticalFlags = this.store.getCriticalFlags();

    if (annotations.length === 0 && criticalFlags.length === 0) {
      this.statusBarItem.text = '$(notebook) CodeLore';
      return;
    }

    const unreviewedCritical = criticalFlags.filter(f => !f.human_reviewed).length;

    const label = annotations.length === 1 ? 'annotation' : 'annotations';
    let text = `$(notebook) ${annotations.length} ${label}`;
    if (unreviewedCritical > 0) {
      text += ` · $(warning) ${unreviewedCritical} critical`;
    }

    this.statusBarItem.text = text;
  }

  dispose(): void {
    this.statusBarItem.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
