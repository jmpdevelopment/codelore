import * as vscode from 'vscode';
import { DiaryStore } from '../storage/diaryStore';
import { CATEGORY_META, AnnotationCategory } from '../models/annotation';
import { verifyAnchor } from '../utils/anchorEngine';
import { getRelativePath } from '../utils/git';
import { sanitizeMarkdownText } from '../utils/validation';

export class AnnotationDecorator implements vscode.Disposable {
  private decorationTypes: Map<AnnotationCategory, vscode.TextEditorDecorationType> = new Map();
  private staleDecorationType: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor(private store: DiaryStore) {
    this.staleDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: '#ff980020',
      after: {
        color: '#ff9800',
        fontStyle: 'italic',
      },
    });
    this.createDecorationTypes();

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.updateAll()),
      vscode.workspace.onDidOpenTextDocument(() => {
        // Delay slightly — editor may not be assigned yet when document opens
        setTimeout(() => this.update(), 100);
      }),
      vscode.workspace.onDidChangeTextDocument(() => this.update()),
      store.onDidChange(() => this.updateAll()),
    );

    // Delay initial update to let the editor finish loading
    setTimeout(() => this.updateAll(), 200);
  }

  private createDecorationTypes(): void {
    for (const [category, meta] of Object.entries(CATEGORY_META)) {
      const type = vscode.window.createTextEditorDecorationType({
        gutterIconPath: undefined, // Using text-based gutter icons
        gutterIconSize: 'contain',
        overviewRulerColor: meta.color,
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        after: {
          color: new vscode.ThemeColor('editorCodeLens.foreground'),
          fontStyle: 'italic',
          margin: '0 0 0 2em',
        },
        isWholeLine: true,
        backgroundColor: `${meta.color}15`,
      });
      this.decorationTypes.set(category as AnnotationCategory, type);
    }
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

    const filePath = getRelativePath(editor.document.uri);
    if (!filePath) { return; }

    const annotations = this.store.getAnnotationsForFile(filePath);
    const fileLines = editor.document.getText().split('\n');

    // Clear all decorations first
    for (const type of this.decorationTypes.values()) {
      editor.setDecorations(type, []);
    }
    editor.setDecorations(this.staleDecorationType, []);

    // Group by category, separating stale annotations
    const byCategory = new Map<AnnotationCategory, vscode.DecorationOptions[]>();
    const staleDecorations: vscode.DecorationOptions[] = [];

    for (const ann of annotations) {
      // Check if anchor is stale
      const isStale = ann.anchor?.content_hash
        ? !verifyAnchor(fileLines, ann.line_start, ann.line_end, ann.anchor.content_hash)
        : false;

      if (isStale) {
        staleDecorations.push({
          range: new vscode.Range(
            Math.max(0, ann.line_start - 1), 0,
            Math.max(0, ann.line_end - 1), Number.MAX_SAFE_INTEGER,
          ),
          renderOptions: {
            after: {
              contentText: `  ⚠ STALE: ${CATEGORY_META[ann.category].icon} ${ann.text.split('\n')[0]}`,
            },
          },
          hoverMessage: this.buildStaleHover(ann.category, ann.text, ann.author, ann.created_at),
        });
        continue;
      }

      const options: vscode.DecorationOptions = {
        range: new vscode.Range(
          Math.max(0, ann.line_start - 1), 0,
          Math.max(0, ann.line_end - 1), Number.MAX_SAFE_INTEGER,
        ),
        renderOptions: {
          after: {
            contentText: `  ${CATEGORY_META[ann.category].icon} ${ann.text.split('\n')[0]}`,
          },
        },
        hoverMessage: this.buildHover(ann.category, ann.text, ann.author, ann.created_at),
      };

      if (!byCategory.has(ann.category)) {
        byCategory.set(ann.category, []);
      }
      byCategory.get(ann.category)!.push(options);
    }

    for (const [category, options] of byCategory) {
      const type = this.decorationTypes.get(category);
      if (type) {
        editor.setDecorations(type, options);
      }
    }

    editor.setDecorations(this.staleDecorationType, staleDecorations);
  }

  private buildHover(category: AnnotationCategory, text: string, author?: string, createdAt?: string): vscode.MarkdownString {
    const meta = CATEGORY_META[category];
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${meta.label}**\n\n`);
    md.appendMarkdown(sanitizeMarkdownText(text) + '\n\n');
    if (author) { md.appendMarkdown(`*— ${sanitizeMarkdownText(author)}*`); }
    if (createdAt) { md.appendMarkdown(` • ${new Date(createdAt).toLocaleString()}`); }
    return md;
  }

  private buildStaleHover(category: AnnotationCategory, text: string, author?: string, createdAt?: string): vscode.MarkdownString {
    const meta = CATEGORY_META[category];
    const md = new vscode.MarkdownString();
    md.isTrusted = { enabledCommands: ['codediary.checkAnchors'] };
    md.appendMarkdown(`**⚠ STALE — ${meta.label}**\n\n`);
    md.appendMarkdown(sanitizeMarkdownText(text) + '\n\n');
    md.appendMarkdown('*The code at this location has changed since this annotation was created.*\n\n');
    md.appendMarkdown('[Re-anchor annotations](command:codediary.checkAnchors)');
    if (author) { md.appendMarkdown(`\n\n*— ${sanitizeMarkdownText(author)}*`); }
    if (createdAt) { md.appendMarkdown(` • ${new Date(createdAt).toLocaleString()}`); }
    return md;
  }

  dispose(): void {
    for (const type of this.decorationTypes.values()) {
      type.dispose();
    }
    this.staleDecorationType.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
