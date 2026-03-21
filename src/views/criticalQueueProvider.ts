import * as vscode from 'vscode';
import { YamlStore } from '../storage/yamlStore';
import { CriticalFlag, CriticalSeverity } from '../models/criticalFlag';

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
    this.tooltip = new vscode.MarkdownString(
      `**${flag.severity.toUpperCase()}** — ${flag.description || 'Manually flagged'}\n\n${flag.human_reviewed ? '✅ Reviewed' : '⚠ Not yet reviewed'}`,
    );

    if (flag.human_reviewed) {
      this.iconPath = new vscode.ThemeIcon('shield', new vscode.ThemeColor('testing.iconPassed'));
    } else {
      this.iconPath = new vscode.ThemeIcon('shield', new vscode.ThemeColor('list.errorForeground'));
    }

    this.command = {
      command: 'vscode.open',
      title: 'Go to critical region',
      arguments: [
        vscode.Uri.file(
          vscode.workspace.workspaceFolders?.[0]
            ? require('path').join(vscode.workspace.workspaceFolders[0].uri.fsPath, flag.file)
            : flag.file,
        ),
        {
          selection: new vscode.Range(flag.line_start - 1, 0, flag.line_end - 1, 0),
        } as vscode.TextDocumentShowOptions,
      ],
    };
  }
}

export class CriticalQueueProvider implements vscode.TreeDataProvider<CriticalNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CriticalNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private store: YamlStore) {
    store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: CriticalNode): vscode.TreeItem {
    return element;
  }

  getChildren(): CriticalNode[] {
    const flags = this.store.getCriticalFlags();
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
