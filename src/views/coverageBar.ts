import * as vscode from 'vscode';
import { DiaryStore } from '../storage/diaryStore';
import { countUniqueLines } from '../utils/validation';

export class CoverageBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(private store: DiaryStore) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.statusBarItem.command = 'codediary.showChangePlan';
    this.statusBarItem.tooltip = 'CodeDiary — Review Coverage';
    this.statusBarItem.show();

    this.disposables.push(
      store.onDidChange(() => this.update()),
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
    );

    this.update();
  }

  update(): void {
    const markers = this.store.getReviewMarkers();
    const annotations = this.store.getAnnotations();
    const criticalFlags = this.store.getCriticalFlags();

    if (markers.length === 0 && annotations.length === 0 && criticalFlags.length === 0) {
      this.statusBarItem.text = '$(notebook) CodeDiary';
      return;
    }

    const totalLines = countUniqueLines(markers);
    const unreviewedCritical = criticalFlags.filter(f => !f.human_reviewed).length;

    let text = `$(notebook) ${annotations.length} notes · ${totalLines} lines reviewed`;
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
