import * as vscode from 'vscode';
import * as path from 'path';
import { DiaryStore } from '../storage/diaryStore';
import { Annotation, CATEGORY_META, AnnotationCategory } from '../models/annotation';

type TreeItem = FileNode | AnnotationNode;

class FileNode extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly annotations: Annotation[],
  ) {
    super(filePath, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${annotations.length} annotation${annotations.length !== 1 ? 's' : ''}`;
    this.iconPath = new vscode.ThemeIcon('file');
    this.contextValue = 'file';
  }
}

class AnnotationNode extends vscode.TreeItem {
  constructor(public readonly annotation: Annotation, scope: 'shared' | 'personal') {
    super(
      `${CATEGORY_META[annotation.category].label}: ${annotation.text.split('\n')[0].substring(0, 60)}`,
      vscode.TreeItemCollapsibleState.None,
    );
    const meta = CATEGORY_META[annotation.category];
    const scopeIcon = scope === 'shared' ? '$(globe)' : '$(lock)';
    this.description = `${scopeIcon} L${annotation.line_start}-${annotation.line_end}`;
    this.tooltip = new vscode.MarkdownString(
      `**${meta.label}**\n\n${annotation.text}\n\n*${annotation.author || 'unknown'} — ${new Date(annotation.created_at).toLocaleString()}*`,
    );
    this.iconPath = new vscode.ThemeIcon(
      meta.icon.replace('$(', '').replace(')', ''),
      new vscode.ThemeColor(this.getColorId(annotation.category)),
    );
    this.contextValue = 'annotation';
    this.command = {
      command: 'vscode.open',
      title: 'Go to annotation',
      arguments: [
        vscode.Uri.file(
          vscode.workspace.workspaceFolders?.[0]
            ? path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, annotation.file)
            : annotation.file,
        ),
        {
          selection: new vscode.Range(
            annotation.line_start - 1, 0,
            annotation.line_end - 1, 0,
          ),
        } as vscode.TextDocumentShowOptions,
      ],
    };
  }

  private getColorId(category: AnnotationCategory): string {
    // Map to built-in theme colors
    switch (category) {
      case 'verified': return 'testing.iconPassed';
      case 'needs_review': return 'list.warningForeground';
      case 'modified': return 'editorInfo.foreground';
      case 'confused': return 'list.warningForeground';
      case 'hallucination': return 'list.errorForeground';
      case 'intent': return 'charts.purple';
      case 'accepted': return 'disabledForeground';
    }
  }
}

export class ChangePlanProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private filterCategory: AnnotationCategory | undefined;

  constructor(private store: DiaryStore) {
    store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setFilter(category: AnnotationCategory | undefined): void {
    this.filterCategory = category;
    this.refresh();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      // Root level: group by file
      let annotations = this.store.getAnnotations();
      if (this.filterCategory) {
        annotations = annotations.filter(a => a.category === this.filterCategory);
      }

      const byFile = new Map<string, Annotation[]>();
      for (const ann of annotations) {
        if (!byFile.has(ann.file)) {
          byFile.set(ann.file, []);
        }
        byFile.get(ann.file)!.push(ann);
      }

      return Array.from(byFile.entries()).map(
        ([file, anns]) => new FileNode(file, anns),
      );
    }

    if (element instanceof FileNode) {
      return element.annotations.map(a => {
        const scope = this.store.getAnnotationScope(a.id);
        return new AnnotationNode(a, scope);
      });
    }

    return [];
  }
}
