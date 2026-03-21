import * as vscode from 'vscode';
import * as path from 'path';
import { DiaryStore } from '../storage/diaryStore';
import { Annotation, CATEGORY_META, EPHEMERAL_CATEGORIES } from '../models/annotation';
import { CriticalFlag } from '../models/criticalFlag';
import { ReviewMarker } from '../models/reviewMarker';
import { gitChangedFiles, gitDiff, getWorkspaceCwd, parseChangedLineRanges, ChangedLineRange } from '../utils/git';
import { isSafeRelativePath, sanitizeMarkdownText } from '../utils/validation';

type BriefTreeItem = SummaryNode | BriefFileNode | KnowledgeNode | NoChangesNode;

// ── Summary header ──────────────────────────────────────────────────

class SummaryNode extends vscode.TreeItem {
  constructor(
    filesChanged: number,
    criticalCount: number,
    annotationCount: number,
    reviewedCount: number,
  ) {
    const parts: string[] = [];
    parts.push(`${filesChanged} file${filesChanged !== 1 ? 's' : ''} changed`);
    if (criticalCount > 0) {
      parts.push(`${criticalCount} critical`);
    }
    if (annotationCount > 0) {
      parts.push(`${annotationCount} annotation${annotationCount !== 1 ? 's' : ''}`);
    }
    if (reviewedCount > 0) {
      parts.push(`${reviewedCount} reviewed`);
    }

    super(parts.join(' · '), vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('git-commit');
    this.contextValue = 'summary';
  }
}

// ── No changes placeholder ──────────────────────────────────────────

class NoChangesNode extends vscode.TreeItem {
  constructor() {
    super('No uncommitted changes', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
    this.description = 'Working tree clean';
  }
}

// ── File-level node ─────────────────────────────────────────────────

interface FileKnowledge {
  filePath: string;
  annotations: Annotation[];
  criticalFlags: CriticalFlag[];
  reviewMarkers: ReviewMarker[];
  changedRanges: ChangedLineRange[];
  overlappingAnnotations: Annotation[];
  overlappingCritical: CriticalFlag[];
}

class BriefFileNode extends vscode.TreeItem {
  constructor(public readonly knowledge: FileKnowledge) {
    super(knowledge.filePath, vscode.TreeItemCollapsibleState.Expanded);

    const { overlappingCritical, overlappingAnnotations, criticalFlags, annotations, reviewMarkers } = knowledge;
    const parts: string[] = [];

    // Overlapping = knowledge that directly covers changed lines
    const unresolvedCritical = overlappingCritical.filter(f => !f.human_reviewed);
    if (unresolvedCritical.length > 0) {
      parts.push(`${unresolvedCritical.length} critical in changes`);
    }
    if (overlappingAnnotations.length > 0) {
      parts.push(`${overlappingAnnotations.length} annotation${overlappingAnnotations.length !== 1 ? 's' : ''} in changes`);
    }
    // Also show total file-level counts if there's more beyond the overlap
    const totalCritical = criticalFlags.filter(f => !f.human_reviewed).length;
    const extraCritical = totalCritical - unresolvedCritical.length;
    const extraAnnotations = annotations.length - overlappingAnnotations.length;
    if (extraCritical > 0) {
      parts.push(`+${extraCritical} critical elsewhere`);
    }
    if (extraAnnotations > 0) {
      parts.push(`+${extraAnnotations} elsewhere`);
    }

    if (parts.length === 0) {
      if (reviewMarkers.length > 0) {
        parts.push('reviewed');
      } else {
        parts.push('no knowledge');
      }
    }

    this.description = parts.join(', ');
    this.iconPath = this.pickIcon(unresolvedCritical.length, overlappingAnnotations.length, reviewMarkers.length);
    this.contextValue = 'briefFile';
  }

  private pickIcon(unresolvedCritical: number, overlappingAnnotations: number, reviewed: number): vscode.ThemeIcon {
    if (unresolvedCritical > 0) {
      return new vscode.ThemeIcon('shield', new vscode.ThemeColor('list.errorForeground'));
    }
    if (overlappingAnnotations > 0) {
      return new vscode.ThemeIcon('note', new vscode.ThemeColor('list.warningForeground'));
    }
    if (reviewed > 0) {
      return new vscode.ThemeIcon('file', new vscode.ThemeColor('testing.iconPassed'));
    }
    return new vscode.ThemeIcon('file');
  }
}

// ── Knowledge item node (annotation or critical flag) ───────────────

class KnowledgeNode extends vscode.TreeItem {
  constructor(item: Annotation | CriticalFlag, overlapsChange: boolean) {
    const isCritical = 'severity' in item;

    if (isCritical) {
      const flag = item as CriticalFlag;
      const prefix = overlapsChange ? '⚡ ' : '';
      super(
        `${prefix}${flag.severity.toUpperCase()} L${flag.line_start}-${flag.line_end}`,
        vscode.TreeItemCollapsibleState.None,
      );
      this.description = sanitizeMarkdownText(flag.description || 'No description');

      const tooltipParts = [
        `**${flag.severity.toUpperCase()}** — ${sanitizeMarkdownText(flag.description || 'Manually flagged')}`,
      ];
      if (overlapsChange) {
        tooltipParts.push('\n\n⚡ **Overlaps your changes** — review before committing');
      }
      if (flag.human_reviewed) {
        tooltipParts.push(`\n\n✅ Resolved by ${sanitizeMarkdownText(flag.resolved_by || 'unknown')}`);
        if (flag.resolution_comment) {
          tooltipParts.push(`\n\n> ${sanitizeMarkdownText(flag.resolution_comment)}`);
        }
      }
      this.tooltip = new vscode.MarkdownString(tooltipParts.join(''));

      this.iconPath = flag.human_reviewed
        ? new vscode.ThemeIcon('shield', new vscode.ThemeColor('testing.iconPassed'))
        : new vscode.ThemeIcon('shield', new vscode.ThemeColor('list.errorForeground'));

    } else {
      const ann = item as Annotation;
      const meta = CATEGORY_META[ann.category];
      const prefix = overlapsChange ? '⚡ ' : '';
      super(
        `${prefix}${meta.label}: ${ann.text.split('\n')[0].substring(0, 60)}`,
        vscode.TreeItemCollapsibleState.None,
      );
      this.description = `L${ann.line_start}-${ann.line_end}`;

      const tooltipParts = [
        `**${meta.label}**\n\n${sanitizeMarkdownText(ann.text)}`,
      ];
      if (overlapsChange) {
        tooltipParts.push('\n\n⚡ **Overlaps your changes**');
      }
      tooltipParts.push(`\n\n*${sanitizeMarkdownText(ann.author || 'unknown')} — ${new Date(ann.created_at).toLocaleString()}*`);
      this.tooltip = new vscode.MarkdownString(tooltipParts.join(''));

      this.iconPath = new vscode.ThemeIcon(
        meta.icon.replace('$(', '').replace(')', ''),
        new vscode.ThemeColor(overlapsChange ? 'list.warningForeground' : 'disabledForeground'),
      );
    }

    this.contextValue = isCritical ? 'briefCritical' : 'briefAnnotation';

    // Navigation command
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    const filePath = isCritical ? (item as CriticalFlag).file : (item as Annotation).file;
    const lineStart = item.line_start;
    const lineEnd = item.line_end;
    if (wsFolder && isSafeRelativePath(filePath)) {
      this.command = {
        command: 'vscode.open',
        title: 'Go to code',
        arguments: [
          vscode.Uri.file(path.join(wsFolder.uri.fsPath, filePath)),
          { selection: new vscode.Range(lineStart - 1, 0, lineEnd - 1, 0) } as vscode.TextDocumentShowOptions,
        ],
      };
    }
  }
}

// ── Provider ────────────────────────────────────────────────────────

export class PreCommitBriefProvider implements vscode.TreeDataProvider<BriefTreeItem>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<BriefTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cachedKnowledge: FileKnowledge[] = [];
  private disposables: vscode.Disposable[] = [];

  constructor(private store: DiaryStore) {
    this.disposables.push(
      store.onDidChange(() => this.refresh()),
      // Refresh when user switches files — git state may have changed
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
    );
  }

  refresh(): void {
    this.cachedKnowledge = [];
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: BriefTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BriefTreeItem): BriefTreeItem[] {
    if (element instanceof BriefFileNode) {
      return this.getFileChildren(element.knowledge);
    }

    if (element) { return []; }

    // Root level
    const knowledge = this.buildKnowledge();
    this.cachedKnowledge = knowledge;

    if (knowledge.length === 0) {
      return [new NoChangesNode()];
    }

    // Compute totals for summary
    let totalCritical = 0;
    let totalAnnotations = 0;
    let totalReviewed = 0;
    for (const fk of knowledge) {
      totalCritical += fk.overlappingCritical.filter(f => !f.human_reviewed).length;
      totalAnnotations += fk.overlappingAnnotations.length;
      totalReviewed += fk.reviewMarkers.length > 0 ? 1 : 0;
    }

    const items: BriefTreeItem[] = [
      new SummaryNode(knowledge.length, totalCritical, totalAnnotations, totalReviewed),
    ];

    // Sort files: unresolved critical overlaps first, then by annotation count, then alphabetical
    const sorted = [...knowledge].sort((a, b) => {
      const aCrit = a.overlappingCritical.filter(f => !f.human_reviewed).length;
      const bCrit = b.overlappingCritical.filter(f => !f.human_reviewed).length;
      if (aCrit !== bCrit) { return bCrit - aCrit; }
      const aKnowledge = a.overlappingAnnotations.length + a.overlappingCritical.length;
      const bKnowledge = b.overlappingAnnotations.length + b.overlappingCritical.length;
      if (aKnowledge !== bKnowledge) { return bKnowledge - aKnowledge; }
      return a.filePath.localeCompare(b.filePath);
    });

    for (const fk of sorted) {
      items.push(new BriefFileNode(fk));
    }

    return items;
  }

  private getFileChildren(knowledge: FileKnowledge): KnowledgeNode[] {
    const nodes: KnowledgeNode[] = [];

    // Critical flags first, overlapping changes highlighted
    const sortedCritical = [...knowledge.criticalFlags].sort((a, b) => {
      const aOverlap = knowledge.overlappingCritical.includes(a) ? 0 : 1;
      const bOverlap = knowledge.overlappingCritical.includes(b) ? 0 : 1;
      return aOverlap - bOverlap;
    });

    for (const flag of sortedCritical) {
      const overlaps = knowledge.overlappingCritical.includes(flag);
      nodes.push(new KnowledgeNode(flag, overlaps));
    }

    // Then annotations, overlapping changes highlighted
    const sortedAnnotations = [...knowledge.annotations].sort((a, b) => {
      const aOverlap = knowledge.overlappingAnnotations.includes(a) ? 0 : 1;
      const bOverlap = knowledge.overlappingAnnotations.includes(b) ? 0 : 1;
      return aOverlap - bOverlap;
    });

    for (const ann of sortedAnnotations) {
      const overlaps = knowledge.overlappingAnnotations.includes(ann);
      nodes.push(new KnowledgeNode(ann, overlaps));
    }

    return nodes;
  }

  private buildKnowledge(): FileKnowledge[] {
    const cwd = getWorkspaceCwd();
    if (!cwd) { return []; }

    const changedFiles = gitChangedFiles(cwd);
    if (changedFiles.length === 0) { return []; }

    const result: FileKnowledge[] = [];

    for (const filePath of changedFiles) {
      const annotations = this.store.getAnnotationsForFile(filePath)
        .filter(a => !EPHEMERAL_CATEGORIES.has(a.category));
      const criticalFlags = this.store.getCriticalFlagsForFile(filePath);
      const reviewMarkers = this.store.getReviewMarkersForFile(filePath);

      // Parse diff to find which lines changed
      const diff = gitDiff(filePath, cwd);
      const changedRanges = diff ? parseChangedLineRanges(diff) : [];

      // Find items that overlap with changed line ranges
      const overlappingAnnotations = annotations.filter(a =>
        rangesOverlap(a.line_start, a.line_end, changedRanges),
      );
      const overlappingCritical = criticalFlags.filter(f =>
        rangesOverlap(f.line_start, f.line_end, changedRanges),
      );

      result.push({
        filePath,
        annotations,
        criticalFlags,
        reviewMarkers,
        changedRanges,
        overlappingAnnotations,
        overlappingCritical,
      });
    }

    return result;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

/** Check if an item's line range overlaps any of the changed ranges. */
export function rangesOverlap(lineStart: number, lineEnd: number, changedRanges: ChangedLineRange[]): boolean {
  for (const range of changedRanges) {
    const changeEnd = range.start + range.count - 1;
    if (lineStart <= changeEnd && lineEnd >= range.start) {
      return true;
    }
  }
  return false;
}
