import * as vscode from 'vscode';
import * as path from 'path';
import { DiaryStore } from '../storage/diaryStore';
import { Annotation, CATEGORY_META, EPHEMERAL_CATEGORIES, FileDependency } from '../models/annotation';
import { Component } from '../models/component';
import { CriticalFlag } from '../models/criticalFlag';
import { gitChangedFiles, gitDiff, getWorkspaceCwd, parseChangedLineRanges, ChangedLineRange } from '../utils/git';
import { isSafeRelativePath, sanitizeMarkdownText, truncateText } from '../utils/validation';

type BriefTreeItem = SummaryNode | ComponentGroupNode | BriefFileNode | KnowledgeNode | DependencyNode | NoChangesNode;

// ── Summary header ──────────────────────────────────────────────────

class SummaryNode extends vscode.TreeItem {
  constructor(
    filesChanged: number,
    criticalCount: number,
    annotationCount: number,
    dependencyCount: number = 0,
  ) {
    const parts: string[] = [];
    parts.push(`${filesChanged} file${filesChanged !== 1 ? 's' : ''} changed`);
    if (criticalCount > 0) {
      parts.push(`${criticalCount} critical`);
    }
    if (dependencyCount > 0) {
      parts.push(`${dependencyCount} dependency link${dependencyCount !== 1 ? 's' : ''}`);
    }
    if (annotationCount > 0) {
      parts.push(`${annotationCount} annotation${annotationCount !== 1 ? 's' : ''}`);
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

/** An annotation from another file that has a dependency link pointing to this file. */
interface IncomingDependency {
  /** The annotation in the other file that declares the dependency. */
  sourceAnnotation: Annotation;
  /** The specific dependency entry pointing to this file. */
  dependency: FileDependency;
}

interface FileKnowledge {
  filePath: string;
  annotations: Annotation[];
  criticalFlags: CriticalFlag[];
  changedRanges: ChangedLineRange[];
  overlappingAnnotations: Annotation[];
  overlappingCritical: CriticalFlag[];
  /** Annotations from other files with dependency links pointing to this changed file. */
  incomingDependencies: IncomingDependency[];
}

class BriefFileNode extends vscode.TreeItem {
  constructor(public readonly knowledge: FileKnowledge) {
    super(knowledge.filePath, vscode.TreeItemCollapsibleState.Expanded);

    const { overlappingCritical, overlappingAnnotations, criticalFlags, annotations, incomingDependencies } = knowledge;
    const parts: string[] = [];

    // Cross-file dependencies are the most critical signal
    if (incomingDependencies.length > 0) {
      parts.push(`${incomingDependencies.length} dependency link${incomingDependencies.length !== 1 ? 's' : ''}`);
    }

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
      parts.push('no knowledge');
    }

    this.description = parts.join(', ');
    this.iconPath = this.pickIcon(unresolvedCritical.length, overlappingAnnotations.length, incomingDependencies.length);
    this.contextValue = 'briefFile';
  }

  private pickIcon(unresolvedCritical: number, overlappingAnnotations: number, dependencies: number): vscode.ThemeIcon {
    if (unresolvedCritical > 0) {
      return new vscode.ThemeIcon('shield', new vscode.ThemeColor('list.errorForeground'));
    }
    if (dependencies > 0) {
      return new vscode.ThemeIcon('references', new vscode.ThemeColor('charts.purple'));
    }
    if (overlappingAnnotations > 0) {
      return new vscode.ThemeIcon('note', new vscode.ThemeColor('list.warningForeground'));
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
      const unverifiedBadge = ann.source === 'ai_generated' ? '🤖 ' : '';
      super(
        `${prefix}${unverifiedBadge}${meta.label}: ${truncateText(ann.text.split('\n')[0], 60)}`,
        vscode.TreeItemCollapsibleState.None,
      );
      const descParts = [`L${ann.line_start}-${ann.line_end}`];
      if (ann.source === 'ai_generated') { descParts.push('unverified AI'); }
      this.description = descParts.join(' · ');

      const tooltipParts = [
        `**${meta.label}**\n\n${sanitizeMarkdownText(ann.text)}`,
      ];
      if (ann.source === 'ai_generated') {
        tooltipParts.push('\n\n🤖 **Unverified AI annotation** — review and click the verify action to confirm');
      } else if (ann.source === 'ai_verified' && ann.verified_by) {
        tooltipParts.push(`\n\n✓ Verified by ${sanitizeMarkdownText(ann.verified_by)}`);
      }
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

// ── Dependency link node ────────────────────────────────────────────

class DependencyNode extends vscode.TreeItem {
  constructor(incoming: IncomingDependency) {
    const src = incoming.sourceAnnotation;
    const dep = incoming.dependency;
    super(
      `🔗 ${dep.relationship}`,
      vscode.TreeItemCollapsibleState.None,
    );
    this.description = `from ${src.file}:${src.line_start}`;

    const tooltipParts = [
      `**Cross-file dependency**\n\n`,
      `**${dep.relationship}**\n\n`,
      `Source: \`${src.file}\` L${src.line_start}-${src.line_end}\n\n`,
      `> ${sanitizeMarkdownText(src.text)}\n\n`,
      `*${sanitizeMarkdownText(src.author || 'unknown')} — ${new Date(src.created_at).toLocaleString()}*`,
    ];
    this.tooltip = new vscode.MarkdownString(tooltipParts.join(''));

    this.iconPath = new vscode.ThemeIcon('references', new vscode.ThemeColor('charts.purple'));
    this.contextValue = 'briefDependency';

    // Navigate to the source annotation
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (wsFolder && isSafeRelativePath(src.file)) {
      this.command = {
        command: 'vscode.open',
        title: 'Go to source',
        arguments: [
          vscode.Uri.file(path.join(wsFolder.uri.fsPath, src.file)),
          { selection: new vscode.Range(src.line_start - 1, 0, src.line_end - 1, 0) } as vscode.TextDocumentShowOptions,
        ],
      };
    }
  }
}

// ── Component group node ────────────────────────────────────────────

/**
 * Header for a set of changed files belonging to the same component
 * (or to no component — the "Untagged" bucket). Only rendered when
 * the workspace defines at least one component.
 */
class ComponentGroupNode extends vscode.TreeItem {
  constructor(
    public readonly groupId: string | null,
    public readonly groupLabel: string,
    public readonly knowledge: FileKnowledge[],
  ) {
    super(groupLabel, vscode.TreeItemCollapsibleState.Expanded);
    const fileCount = knowledge.length;
    const unresolvedCritical = knowledge.reduce(
      (sum, fk) => sum + fk.overlappingCritical.filter(f => !f.human_reviewed).length,
      0,
    );
    const parts = [`${fileCount} file${fileCount !== 1 ? 's' : ''}`];
    if (unresolvedCritical > 0) {
      parts.push(`${unresolvedCritical} critical`);
    }
    this.description = parts.join(' · ');
    this.iconPath = groupId
      ? new vscode.ThemeIcon('symbol-namespace')
      : new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
    this.contextValue = groupId ? 'briefComponent' : 'briefUntagged';
  }
}

/**
 * Buckets changed files by component membership. A file in multiple components
 * appears under each — duplication is intentional so users see every relevant
 * subsystem, even when ownership overlaps. Files in zero components fall into
 * an "Untagged" bucket. Returned groups are sorted: highest unresolved-critical
 * count first, then file count, then component name; the untagged bucket is
 * always last.
 */
export interface ComponentGroup {
  componentId: string | null;
  label: string;
  knowledge: FileKnowledge[];
}

export function groupKnowledgeByComponent(
  knowledge: FileKnowledge[],
  components: Component[],
): ComponentGroup[] {
  const componentByFile = new Map<string, Component[]>();
  for (const c of components) {
    for (const f of c.files) {
      const existing = componentByFile.get(f);
      if (existing) { existing.push(c); }
      else { componentByFile.set(f, [c]); }
    }
  }

  const groups = new Map<string, ComponentGroup>();
  const ensureGroup = (id: string | null, label: string): ComponentGroup => {
    const key = id ?? '__untagged__';
    let group = groups.get(key);
    if (!group) {
      group = { componentId: id, label, knowledge: [] };
      groups.set(key, group);
    }
    return group;
  };

  for (const fk of knowledge) {
    const matching = componentByFile.get(fk.filePath) ?? [];
    if (matching.length === 0) {
      ensureGroup(null, 'Untagged files').knowledge.push(fk);
    } else {
      for (const c of matching) {
        ensureGroup(c.id, c.name).knowledge.push(fk);
      }
    }
  }

  return [...groups.values()].sort((a, b) => {
    if ((a.componentId === null) !== (b.componentId === null)) {
      return a.componentId === null ? 1 : -1;
    }
    const aCrit = a.knowledge.reduce((s, fk) => s + fk.overlappingCritical.filter(f => !f.human_reviewed).length, 0);
    const bCrit = b.knowledge.reduce((s, fk) => s + fk.overlappingCritical.filter(f => !f.human_reviewed).length, 0);
    if (aCrit !== bCrit) { return bCrit - aCrit; }
    if (a.knowledge.length !== b.knowledge.length) { return b.knowledge.length - a.knowledge.length; }
    return a.label.localeCompare(b.label);
  });
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

    if (element instanceof ComponentGroupNode) {
      return this.sortFileKnowledge(element.knowledge).map(fk => new BriefFileNode(fk));
    }

    if (element) { return []; }

    // Root level
    const knowledge = this.buildKnowledge();
    this.cachedKnowledge = knowledge;

    if (knowledge.length === 0) {
      return [new NoChangesNode()];
    }

    // Compute totals for summary (count each changed file once even if it
    // surfaces under multiple component groups below).
    let totalCritical = 0;
    let totalAnnotations = 0;
    let totalDependencies = 0;
    for (const fk of knowledge) {
      totalCritical += fk.overlappingCritical.filter(f => !f.human_reviewed).length;
      totalAnnotations += fk.overlappingAnnotations.length;
      totalDependencies += fk.incomingDependencies.length;
    }

    const items: BriefTreeItem[] = [
      new SummaryNode(knowledge.length, totalCritical, totalAnnotations, totalDependencies),
    ];

    const components = this.store.getComponents();
    if (components.length > 0) {
      const groups = groupKnowledgeByComponent(knowledge, components);
      for (const g of groups) {
        items.push(new ComponentGroupNode(g.componentId, g.label, g.knowledge));
      }
      return items;
    }

    // No components defined — fall back to the flat layout.
    for (const fk of this.sortFileKnowledge(knowledge)) {
      items.push(new BriefFileNode(fk));
    }

    return items;
  }

  private sortFileKnowledge(knowledge: FileKnowledge[]): FileKnowledge[] {
    return [...knowledge].sort((a, b) => {
      const aCrit = a.overlappingCritical.filter(f => !f.human_reviewed).length;
      const bCrit = b.overlappingCritical.filter(f => !f.human_reviewed).length;
      if (aCrit !== bCrit) { return bCrit - aCrit; }
      const aDeps = a.incomingDependencies.length;
      const bDeps = b.incomingDependencies.length;
      if (aDeps !== bDeps) { return bDeps - aDeps; }
      const aKnowledge = a.overlappingAnnotations.length + a.overlappingCritical.length;
      const bKnowledge = b.overlappingAnnotations.length + b.overlappingCritical.length;
      if (aKnowledge !== bKnowledge) { return bKnowledge - aKnowledge; }
      return a.filePath.localeCompare(b.filePath);
    });
  }

  private getFileChildren(knowledge: FileKnowledge): BriefTreeItem[] {
    const nodes: BriefTreeItem[] = [];

    // Cross-file dependencies first — these are the most actionable
    for (const dep of knowledge.incomingDependencies) {
      nodes.push(new DependencyNode(dep));
    }

    // Critical flags, overlapping changes highlighted
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

    const changedFiles = gitChangedFiles(cwd)
      .filter(f => !f.startsWith('.codediary/') && !f.endsWith('codediary.yaml'));
    if (changedFiles.length === 0) { return []; }

    // Build a map of incoming dependencies: which annotations point to which files
    const allAnnotations = this.store.getAnnotations()
      .filter(a => !EPHEMERAL_CATEGORIES.has(a.category));
    const incomingByFile = new Map<string, IncomingDependency[]>();
    for (const ann of allAnnotations) {
      if (!ann.dependencies) { continue; }
      for (const dep of ann.dependencies) {
        if (!incomingByFile.has(dep.file)) { incomingByFile.set(dep.file, []); }
        incomingByFile.get(dep.file)!.push({ sourceAnnotation: ann, dependency: dep });
      }
    }

    const result: FileKnowledge[] = [];

    for (const filePath of changedFiles) {
      const annotations = this.store.getAnnotationsForFile(filePath)
        .filter(a => !EPHEMERAL_CATEGORIES.has(a.category));
      const criticalFlags = this.store.getCriticalFlagsForFile(filePath);

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

      // Gather incoming dependencies from other files
      const incomingDependencies = incomingByFile.get(filePath) ?? [];

      result.push({
        filePath,
        annotations,
        criticalFlags,
        changedRanges,
        overlappingAnnotations,
        overlappingCritical,
        incomingDependencies,
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
