import * as vscode from 'vscode';
import { YamlStore } from '../storage/yamlStore';
import { CriticalSeverity } from '../models/criticalFlag';

const SEVERITY_COLORS: Record<CriticalSeverity, string> = {
  critical: '#f44336',
  high: '#ff5722',
  medium: '#ff9800',
};

export class CriticalDecorator implements vscode.Disposable {
  private unreviewedDecoration: vscode.TextEditorDecorationType;
  private reviewedDecoration: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor(private store: YamlStore) {
    this.unreviewedDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      overviewRulerColor: '#f44336',
      overviewRulerLane: vscode.OverviewRulerLane.Center,
      backgroundColor: '#f4433615',
      after: {
        contentText: ' ⚠ critical',
        color: '#f44336',
        fontStyle: 'italic',
      },
    });

    this.reviewedDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      overviewRulerColor: '#4caf50',
      overviewRulerLane: vscode.OverviewRulerLane.Center,
      after: {
        contentText: ' ✓ critical-reviewed',
        color: '#4caf50',
        fontStyle: 'italic',
      },
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      vscode.workspace.onDidChangeTextDocument(() => this.update()),
      store.onDidChange(() => this.update()),
    );

    this.update();
  }

  update(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const filePath = this.getRelativePath(editor.document.uri);
    if (!filePath) { return; }

    const flags = this.store.getCriticalFlagsForFile(filePath);

    const unreviewed: vscode.DecorationOptions[] = [];
    const reviewed: vscode.DecorationOptions[] = [];

    for (const flag of flags) {
      const range = new vscode.Range(
        Math.max(0, flag.line_start - 1), 0,
        Math.max(0, flag.line_end - 1), Number.MAX_SAFE_INTEGER,
      );
      const severityColor = SEVERITY_COLORS[flag.severity];
      const hover = new vscode.MarkdownString(
        `**Critical Region** (${flag.severity})\n\n${flag.description || 'Manually flagged as critical'}`,
      );

      const option: vscode.DecorationOptions = {
        range,
        hoverMessage: hover,
        renderOptions: {
          after: {
            contentText: flag.human_reviewed
              ? ` ✓ ${flag.severity}`
              : ` ⚠ ${flag.severity}`,
            color: flag.human_reviewed ? '#4caf50' : severityColor,
          },
        },
      };

      if (flag.human_reviewed) {
        reviewed.push(option);
      } else {
        unreviewed.push(option);
      }
    }

    editor.setDecorations(this.unreviewedDecoration, unreviewed);
    editor.setDecorations(this.reviewedDecoration, reviewed);
  }

  private getRelativePath(uri: vscode.Uri): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) { return undefined; }
    return vscode.workspace.asRelativePath(uri, false);
  }

  dispose(): void {
    this.unreviewedDecoration.dispose();
    this.reviewedDecoration.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
