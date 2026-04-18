import * as vscode from 'vscode';
import * as path from 'path';
import { DiaryStore } from '../storage/diaryStore';
import { Component } from '../models/component';
import { isSafeRelativePath, sanitizeMarkdownText } from '../utils/validation';

type Node = ComponentNode | FileNode;

class ComponentNode extends vscode.TreeItem {
  constructor(public readonly component: Component) {
    super(component.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `component:${component.id}`;
    this.description = `${component.files.length} file${component.files.length !== 1 ? 's' : ''}`;
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    this.contextValue = 'component';

    const lines: string[] = [`**${sanitizeMarkdownText(component.name)}** \`${component.id}\``];
    if (component.description) {
      lines.push('', sanitizeMarkdownText(component.description));
    }
    if (component.owners && component.owners.length > 0) {
      lines.push('', `Owners: ${component.owners.map(sanitizeMarkdownText).join(', ')}`);
    }
    lines.push('', `_Authored by ${component.source === 'human_authored' ? 'human' : 'AI'}_`);
    this.tooltip = new vscode.MarkdownString(lines.join('\n'));
  }
}

class FileNode extends vscode.TreeItem {
  constructor(public readonly filePath: string, componentId: string) {
    super(filePath, vscode.TreeItemCollapsibleState.None);
    this.id = `component-file:${componentId}:${filePath}`;
    this.iconPath = new vscode.ThemeIcon('file');
    this.contextValue = 'componentFile';

    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (wsFolder && isSafeRelativePath(filePath)) {
      this.command = {
        command: 'vscode.open',
        title: 'Open file',
        arguments: [vscode.Uri.file(path.join(wsFolder.uri.fsPath, filePath))],
      };
    }
  }
}

/**
 * TreeView provider for `.codediary/components/*.yaml`. Root nodes are
 * components (collapsible); children are the tagged file paths. Refreshes
 * automatically when the store fires onDidChange, including when the
 * component YAML files change on disk.
 */
export class ComponentsProvider implements vscode.TreeDataProvider<Node> {
  private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: DiaryStore) {
    store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  getChildren(element?: Node): Node[] {
    if (!element) {
      return this.store.getComponents()
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => new ComponentNode(c));
    }
    if (element instanceof ComponentNode) {
      return element.component.files
        .slice()
        .sort((a, b) => a.localeCompare(b))
        .map(f => new FileNode(f, element.component.id));
    }
    return [];
  }
}
