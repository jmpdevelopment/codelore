import * as vscode from 'vscode';
import { DiaryStore } from '../storage/diaryStore';

export class CoverageBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(private store: DiaryStore) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.statusBarItem.command = 'codediary.showPreCommitBrief';
    this.statusBarItem.tooltip = 'CodeDiary — Knowledge Coverage';
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
      this.statusBarItem.text = '$(notebook) CodeDiary';
      return;
    }

    const unreviewedCritical = criticalFlags.filter(f => !f.human_reviewed).length;

    let text = `$(notebook) ${annotations.length} notes`;
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
