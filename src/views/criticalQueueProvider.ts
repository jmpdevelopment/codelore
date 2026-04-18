import * as vscode from 'vscode';
import * as path from 'path';
import { LoreStore } from '../storage/loreStore';
import { CriticalFlag, CriticalSeverity } from '../models/criticalFlag';
import { isSafeRelativePath, sanitizeMarkdownText } from '../utils/validation';

const SEVERITY_ORDER: Record<CriticalSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

class CriticalNode extends vscode.TreeItem {
  constructor(public readonly flag: CriticalFlag) {
    super(
      `${flag.file} L${flag.line_start}-${flag.line_end}`,
      vscode.TreeItemCollapsibleState.None,
    );

    this.description = flag.severity;
    this.contextValue = 'criticalFlag';

    const tooltipParts = [
      `**${flag.severity.toUpperCase()}** — ${sanitizeMarkdownText(flag.description || 'Manually flagged')}`,
    ];
    if (flag.human_reviewed) {
      tooltipParts.push(`\n\n✅ **Resolved** by ${sanitizeMarkdownText(flag.resolved_by || 'unknown')}`);
      if (flag.resolved_at) {
        tooltipParts.push(` on ${new Date(flag.resolved_at).toLocaleString()}`);
      }
      if (flag.resolution_comment) {
        tooltipParts.push(`\n\n> ${sanitizeMarkdownText(flag.resolution_comment)}`);
      }
    } else {
      tooltipParts.push('\n\n⚠ Not yet reviewed');
    }
    this.tooltip = new vscode.MarkdownString(tooltipParts.join(''));

    if (flag.human_reviewed) {
      this.iconPath = new vscode.ThemeIcon('shield', new vscode.ThemeColor('testing.iconPassed'));
    } else {
      this.iconPath = new vscode.ThemeIcon('shield', new vscode.ThemeColor('list.errorForeground'));
    }

    // Only create navigation command for safe relative paths
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (wsFolder && isSafeRelativePath(flag.file)) {
      this.command = {
        command: 'vscode.open',
        title: 'Go to critical region',
        arguments: [
          vscode.Uri.file(path.join(wsFolder.uri.fsPath, flag.file)),
          {
            selection: new vscode.Range(flag.line_start - 1, 0, flag.line_end - 1, 0),
          } as vscode.TextDocumentShowOptions,
        ],
      };
    }
  }
}

export class CriticalQueueProvider implements vscode.TreeDataProvider<CriticalNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CriticalNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private filterPath: string | undefined;
  private filterSeverity: CriticalSeverity | undefined;

  constructor(private store: LoreStore) {
    store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setPathFilter(pathFilter: string | undefined): void {
    this.filterPath = pathFilter;
    this.refresh();
  }

  setSeverityFilter(severity: CriticalSeverity | undefined): void {
    this.filterSeverity = severity;
    this.refresh();
  }

  getActiveFilters(): { path?: string; severity?: CriticalSeverity } {
    return { path: this.filterPath, severity: this.filterSeverity };
  }

  getTreeItem(element: CriticalNode): vscode.TreeItem {
    return element;
  }

  getChildren(): CriticalNode[] {
    let flags = this.store.getCriticalFlags();

    if (this.filterPath) {
      const pathLower = this.filterPath.toLowerCase();
      flags = flags.filter(f => f.file.toLowerCase().includes(pathLower));
    }
    if (this.filterSeverity) {
      flags = flags.filter(f => f.severity === this.filterSeverity);
    }

    // Sort: unreviewed first, then by severity
    const sorted = [...flags].sort((a, b) => {
      if (a.human_reviewed !== b.human_reviewed) {
        return a.human_reviewed ? 1 : -1;
      }
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    });
    return sorted.map(f => new CriticalNode(f));
  }
}
