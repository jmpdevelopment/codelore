import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { CriticalQueueProvider } from '../../src/views/criticalQueueProvider';
import { DiaryStore } from '../../src/storage/diaryStore';
import { CriticalFlag } from '../../src/models/criticalFlag';

let tmpDir: string;

function makeFlag(overrides: Partial<CriticalFlag> = {}): CriticalFlag {
  return {
    file: 'src/foo.ts',
    line_start: 5,
    line_end: 15,
    severity: 'critical',
    human_reviewed: false,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-cq-'));
  fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
  __setWorkspaceFolder(tmpDir);
  __setConfig({
    'codediary.storagePath': '.vscode/codediary.yaml',
    'codediary.defaultScope': 'shared',
  });
});

afterEach(() => {
  __clearWorkspace();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('CriticalQueueProvider', () => {
  it('returns empty when no flags', () => {
    const store = new DiaryStore();
    const provider = new CriticalQueueProvider(store);
    expect(provider.getChildren()).toEqual([]);
    store.dispose();
  });

  it('returns nodes for each flag', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag({ file: 'a.ts', line_start: 1, line_end: 5 }));
    store.addCriticalFlag(makeFlag({ file: 'b.ts', line_start: 10, line_end: 20 }));
    const provider = new CriticalQueueProvider(store);
    expect(provider.getChildren()).toHaveLength(2);
    store.dispose();
  });

  it('sorts unreviewed before reviewed', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag({ file: 'reviewed.ts', human_reviewed: true, line_start: 1, line_end: 5 }));
    store.addCriticalFlag(makeFlag({ file: 'unreviewed.ts', human_reviewed: false, line_start: 1, line_end: 5 }));
    const provider = new CriticalQueueProvider(store);
    const nodes = provider.getChildren();
    expect((nodes[0] as any).flag.file).toBe('unreviewed.ts');
    expect((nodes[1] as any).flag.file).toBe('reviewed.ts');
    store.dispose();
  });

  it('sorts by severity within same review status', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag({ file: 'medium.ts', severity: 'medium', line_start: 1, line_end: 5 }));
    store.addCriticalFlag(makeFlag({ file: 'critical.ts', severity: 'critical', line_start: 1, line_end: 5 }));
    store.addCriticalFlag(makeFlag({ file: 'high.ts', severity: 'high', line_start: 1, line_end: 5 }));
    const provider = new CriticalQueueProvider(store);
    const nodes = provider.getChildren();
    expect((nodes[0] as any).flag.severity).toBe('critical');
    expect((nodes[1] as any).flag.severity).toBe('high');
    expect((nodes[2] as any).flag.severity).toBe('medium');
    store.dispose();
  });

  it('nodes have contextValue criticalFlag', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag());
    const provider = new CriticalQueueProvider(store);
    const nodes = provider.getChildren();
    expect((nodes[0] as any).contextValue).toBe('criticalFlag');
    store.dispose();
  });

  it('node has severity in description', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag({ severity: 'high' }));
    const provider = new CriticalQueueProvider(store);
    const nodes = provider.getChildren();
    expect((nodes[0] as any).description).toBe('high');
    store.dispose();
  });

  it('node tooltip shows resolution info when reviewed', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag({
      human_reviewed: true,
      resolved_by: 'bob',
      resolved_at: '2026-03-21T10:00:00Z',
      resolution_comment: 'False positive',
    }));
    const provider = new CriticalQueueProvider(store);
    const nodes = provider.getChildren();
    const tooltip = (nodes[0] as any).tooltip;
    expect(tooltip.value).toContain('Resolved');
    expect(tooltip.value).toContain('bob');
    expect(tooltip.value).toContain('False positive');
    store.dispose();
  });

  it('node tooltip shows unreviewed status', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag({ description: 'Token validation' }));
    const provider = new CriticalQueueProvider(store);
    const nodes = provider.getChildren();
    const tooltip = (nodes[0] as any).tooltip;
    expect(tooltip.value).toContain('Not yet reviewed');
    expect(tooltip.value).toContain('CRITICAL');
    store.dispose();
  });

  it('getTreeItem returns the element itself', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag());
    const provider = new CriticalQueueProvider(store);
    const nodes = provider.getChildren();
    expect(provider.getTreeItem(nodes[0])).toBe(nodes[0]);
    store.dispose();
  });

  it('fires onDidChangeTreeData on refresh', () => {
    const store = new DiaryStore();
    const provider = new CriticalQueueProvider(store);
    let fired = false;
    provider.onDidChangeTreeData(() => { fired = true; });
    provider.refresh();
    expect(fired).toBe(true);
    store.dispose();
  });

  it('refreshes when store changes', () => {
    const store = new DiaryStore();
    const provider = new CriticalQueueProvider(store);
    let fired = 0;
    provider.onDidChangeTreeData(() => { fired++; });
    store.addCriticalFlag(makeFlag());
    expect(fired).toBeGreaterThan(0);
    store.dispose();
  });

  it('node has command to open file', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag());
    const provider = new CriticalQueueProvider(store);
    const nodes = provider.getChildren();
    expect((nodes[0] as any).command).toBeDefined();
    expect((nodes[0] as any).command.command).toBe('vscode.open');
    store.dispose();
  });

  it('filters by file path', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag({ file: 'src/auth/login.ts', line_start: 1, line_end: 5 }));
    store.addCriticalFlag(makeFlag({ file: 'src/billing/charge.ts', line_start: 10, line_end: 20 }));
    store.addCriticalFlag(makeFlag({ file: 'src/auth/tokens.ts', line_start: 30, line_end: 40 }));
    const provider = new CriticalQueueProvider(store);

    provider.setPathFilter('src/auth');
    const filtered = provider.getChildren();
    expect(filtered).toHaveLength(2);
    store.dispose();
  });

  it('path filter is case insensitive', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag({ file: 'src/Auth/Login.ts' }));
    const provider = new CriticalQueueProvider(store);

    provider.setPathFilter('auth');
    expect(provider.getChildren()).toHaveLength(1);
    store.dispose();
  });

  it('clears path filter with undefined', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag({ file: 'src/auth/login.ts', line_start: 1, line_end: 5 }));
    store.addCriticalFlag(makeFlag({ file: 'src/billing/charge.ts', line_start: 10, line_end: 20 }));
    const provider = new CriticalQueueProvider(store);

    provider.setPathFilter('auth');
    expect(provider.getChildren()).toHaveLength(1);

    provider.setPathFilter(undefined);
    expect(provider.getChildren()).toHaveLength(2);
    store.dispose();
  });

  it('filters by severity', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag({ severity: 'critical', file: 'a.ts', line_start: 1, line_end: 5 }));
    store.addCriticalFlag(makeFlag({ severity: 'high', file: 'b.ts', line_start: 1, line_end: 5 }));
    store.addCriticalFlag(makeFlag({ severity: 'critical', file: 'c.ts', line_start: 1, line_end: 5 }));
    const provider = new CriticalQueueProvider(store);

    provider.setSeverityFilter('critical');
    expect(provider.getChildren()).toHaveLength(2);

    provider.setSeverityFilter('high');
    expect(provider.getChildren()).toHaveLength(1);

    provider.setSeverityFilter(undefined);
    expect(provider.getChildren()).toHaveLength(3);
    store.dispose();
  });

  it('combines path and severity filters', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag({ file: 'src/auth/login.ts', severity: 'critical', line_start: 1, line_end: 5 }));
    store.addCriticalFlag(makeFlag({ file: 'src/auth/tokens.ts', severity: 'medium', line_start: 10, line_end: 20 }));
    store.addCriticalFlag(makeFlag({ file: 'src/billing/charge.ts', severity: 'critical', line_start: 30, line_end: 40 }));
    const provider = new CriticalQueueProvider(store);

    provider.setPathFilter('src/auth');
    provider.setSeverityFilter('critical');
    expect(provider.getChildren()).toHaveLength(1);
    expect((provider.getChildren()[0] as any).flag.file).toBe('src/auth/login.ts');
    store.dispose();
  });

  it('getActiveFilters returns current filter state', () => {
    const store = new DiaryStore();
    const provider = new CriticalQueueProvider(store);

    expect(provider.getActiveFilters()).toEqual({ path: undefined, severity: undefined });

    provider.setPathFilter('src/auth');
    provider.setSeverityFilter('critical');
    expect(provider.getActiveFilters()).toEqual({ path: 'src/auth', severity: 'critical' });
    store.dispose();
  });

  it('maintains sort order with filters applied', () => {
    const store = new DiaryStore();
    store.addCriticalFlag(makeFlag({ file: 'src/auth/a.ts', severity: 'medium', human_reviewed: false, line_start: 1, line_end: 5 }));
    store.addCriticalFlag(makeFlag({ file: 'src/auth/b.ts', severity: 'critical', human_reviewed: false, line_start: 1, line_end: 5 }));
    store.addCriticalFlag(makeFlag({ file: 'src/auth/c.ts', severity: 'high', human_reviewed: true, line_start: 1, line_end: 5 }));
    const provider = new CriticalQueueProvider(store);

    provider.setPathFilter('src/auth');
    const nodes = provider.getChildren();
    // Unreviewed first (critical, medium), then reviewed (high)
    expect((nodes[0] as any).flag.severity).toBe('critical');
    expect((nodes[1] as any).flag.severity).toBe('medium');
    expect((nodes[2] as any).flag.severity).toBe('high');
    store.dispose();
  });
});
