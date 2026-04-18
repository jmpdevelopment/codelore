import * as vscode from 'vscode';
import * as path from 'path';
import { DiaryStore } from '../storage/diaryStore';
import { Annotation, CATEGORY_META, AnnotationCategory } from '../models/annotation';
import { isSafeRelativePath, sanitizeMarkdownText, truncateText } from '../utils/validation';

type TreeItem = FileNode | AnnotationNode;

class FileNode extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly annotations: Annotation[],
  ) {
    super(filePath, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${annotations.length} annotation${annotations.length !== 1 ? 's' : ''}`;
    this.iconPath = new vscode.ThemeIcon('file');
    this.contextValue = 'file';
  }
}

class AnnotationNode extends vscode.TreeItem {
  constructor(public readonly annotation: Annotation, scope: 'shared' | 'personal') {
    super(
      `${CATEGORY_META[annotation.category].label}: ${truncateText(annotation.text.split('\n')[0], 60)}`,
      vscode.TreeItemCollapsibleState.None,
    );
    const meta = CATEGORY_META[annotation.category];
    const scopeIcon = scope === 'shared' ? '$(globe)' : '$(lock)';
    this.description = `${scopeIcon} L${annotation.line_start}-${annotation.line_end}`;
    this.tooltip = new vscode.MarkdownString(
      `**${meta.label}**\n\n${sanitizeMarkdownText(annotation.text)}\n\n*${sanitizeMarkdownText(annotation.author || 'unknown')} — ${new Date(annotation.created_at).toLocaleString()}*`,
    );
    this.iconPath = new vscode.ThemeIcon(
      meta.icon.replace('$(', '').replace(')', ''),
      new vscode.ThemeColor(this.getColorId(annotation.category)),
    );
    // ai_generated rows get their own contextValue so the verify action only
    // surfaces where it makes sense — see view/item/context in package.json.
    this.contextValue = annotation.source === 'ai_generated' ? 'annotation-ai-generated' : 'annotation';

    // Only create navigation command for safe relative paths
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (wsFolder && isSafeRelativePath(annotation.file)) {
      this.command = {
        command: 'vscode.open',
        title: 'Go to annotation',
        arguments: [
          vscode.Uri.file(path.join(wsFolder.uri.fsPath, annotation.file)),
          {
            selection: new vscode.Range(
              annotation.line_start - 1, 0,
              annotation.line_end - 1, 0,
            ),
          } as vscode.TextDocumentShowOptions,
        ],
      };
    }
  }

  private getColorId(category: AnnotationCategory): string {
    switch (category) {
      case 'behavior': return 'charts.blue';
      case 'rationale': return 'charts.yellow';
      case 'constraint': return 'descriptionForeground';
      case 'gotcha': return 'list.warningForeground';
      case 'performance': return 'charts.green';
      case 'security': return 'list.errorForeground';
      case 'human_note': return 'descriptionForeground';
      case 'business_rule': return 'list.errorForeground';
      case 'ai_prompt': return 'editorInfo.foreground';
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
  private filterPath: string | undefined;
  private filterComponent: string | undefined;

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

  setPathFilter(pathFilter: string | undefined): void {
    this.filterPath = pathFilter;
    this.refresh();
  }

  setComponentFilter(componentId: string | undefined): void {
    this.filterComponent = componentId;
    this.refresh();
  }

  getActiveFilters(): { category?: AnnotationCategory; path?: string; component?: string } {
    return { category: this.filterCategory, path: this.filterPath, component: this.filterComponent };
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
      if (this.filterPath) {
        const pathLower = this.filterPath.toLowerCase();
        annotations = annotations.filter(a => a.file.toLowerCase().includes(pathLower));
      }
      if (this.filterComponent) {
        // Match either explicit per-annotation tag OR file-level membership.
        // Mirrors DiaryStore.search so the two surfaces feel consistent.
        const componentFiles = new Set(this.store.getComponent(this.filterComponent)?.files ?? []);
        const componentId = this.filterComponent;
        annotations = annotations.filter(a =>
          a.components?.includes(componentId) || componentFiles.has(a.file),
        );
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
