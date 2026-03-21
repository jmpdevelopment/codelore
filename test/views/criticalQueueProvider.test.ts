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
});
