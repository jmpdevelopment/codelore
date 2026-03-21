import * as vscode from 'vscode';
import { DiaryStore } from '../storage/diaryStore';

export class ReviewMarkerDecorator implements vscode.Disposable {
  private reviewedDecoration: vscode.TextEditorDecorationType;
  private unreviewedDecoration: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor(private store: DiaryStore) {
    this.reviewedDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: undefined,
      isWholeLine: true,
      overviewRulerColor: '#4caf50',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      after: {
        contentText: ' ✓',
        color: '#4caf50',
      },
    });

    this.unreviewedDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('codediary.unreviewedBackground'),
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.updateAll()),
      vscode.workspace.onDidOpenTextDocument(() => {
        setTimeout(() => this.update(), 100);
      }),
      vscode.workspace.onDidChangeTextDocument(() => this.update()),
      store.onDidChange(() => this.updateAll()),
    );

    setTimeout(() => this.updateAll(), 200);
  }

  updateAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.updateEditor(editor);
    }
  }

  update(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }
    this.updateEditor(editor);
  }

  private updateEditor(editor: vscode.TextEditor): void {

    const filePath = this.getRelativePath(editor.document.uri);
    if (!filePath) { return; }

    const markers = this.store.getReviewMarkersForFile(filePath);
    const config = vscode.workspace.getConfiguration('codediary');
    const highlightUnreviewed = config.get<boolean>('highlightUnreviewed', true);

    // Reviewed ranges
    const reviewedRanges: vscode.DecorationOptions[] = markers.map(m => ({
      range: new vscode.Range(
        Math.max(0, m.line_start - 1), 0,
        Math.max(0, m.line_end - 1), Number.MAX_SAFE_INTEGER,
      ),
      hoverMessage: new vscode.MarkdownString(
        `**Reviewed** by ${m.reviewer}\n\n${new Date(m.reviewed_at).toLocaleString()}`,
      ),
    }));

    editor.setDecorations(this.reviewedDecoration, reviewedRanges);

    // Unreviewed highlighting is informational only — we don't compute
    // which lines are "changed" here since that requires git diff integration.
    // For now we just show reviewed markers. Unreviewed highlighting will
    // be enhanced when we integrate with git diff data.
    if (!highlightUnreviewed) {
      editor.setDecorations(this.unreviewedDecoration, []);
    }
  }

  private getRelativePath(uri: vscode.Uri): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) { return undefined; }
    return vscode.workspace.asRelativePath(uri, false);
  }

  dispose(): void {
    this.reviewedDecoration.dispose();
    this.unreviewedDecoration.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
