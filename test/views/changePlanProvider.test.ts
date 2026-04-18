import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { ChangePlanProvider } from '../../src/views/changePlanProvider';
import { DiaryStore } from '../../src/storage/diaryStore';
import { Annotation } from '../../src/models/annotation';

let tmpDir: string;

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'ann-1',
    file: 'src/foo.ts',
    line_start: 10,
    line_end: 20,
    category: 'verified',
    text: 'Looks good',
    source: 'human_authored',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-view-'));
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

describe('ChangePlanProvider', () => {
  it('returns empty root when no annotations', () => {
    const store = new DiaryStore();
    const provider = new ChangePlanProvider(store);
    expect(provider.getChildren()).toEqual([]);
    store.dispose();
  });

  it('returns file nodes at root level', () => {
    const store = new DiaryStore();
    store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/foo.ts' }));
    store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/bar.ts' }));
    const provider = new ChangePlanProvider(store);
    const children = provider.getChildren();
    expect(children).toHaveLength(2);
    // FileNode has filePath property
    const filePaths = children.map((c: any) => c.filePath);
    expect(filePaths.sort()).toEqual(['src/bar.ts', 'src/foo.ts']);
    store.dispose();
  });

  it('returns annotation nodes for file node children', () => {
    const store = new DiaryStore();
    store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/foo.ts' }));
    store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/foo.ts', category: 'needs_review' }));
    const provider = new ChangePlanProvider(store);
    const fileNodes = provider.getChildren();
    expect(fileNodes).toHaveLength(1);
    const annotationNodes = provider.getChildren(fileNodes[0]);
    expect(annotationNodes).toHaveLength(2);
    store.dispose();
  });

  it('returns empty array for annotation node children', () => {
    const store = new DiaryStore();
    store.addAnnotation(makeAnnotation());
    const provider = new ChangePlanProvider(store);
    const fileNodes = provider.getChildren();
    const annotationNodes = provider.getChildren(fileNodes[0]);
    const leaf = provider.getChildren(annotationNodes[0]);
    expect(leaf).toEqual([]);
    store.dispose();
  });

  it('filters by category', () => {
    const store = new DiaryStore();
    store.addAnnotation(makeAnnotation({ id: 'a1', category: 'verified' }));
    store.addAnnotation(makeAnnotation({ id: 'a2', category: 'needs_review' }));
    const provider = new ChangePlanProvider(store);

    provider.setFilter('verified');
    const filtered = provider.getChildren();
    expect(filtered).toHaveLength(1);
    const annotations = provider.getChildren(filtered[0]);
    expect(annotations).toHaveLength(1);

    provider.setFilter(undefined);
    expect(provider.getChildren()[0]).toBeDefined();
    store.dispose();
  });

  it('getTreeItem returns the element itself', () => {
    const store = new DiaryStore();
    store.addAnnotation(makeAnnotation());
    const provider = new ChangePlanProvider(store);
    const children = provider.getChildren();
    expect(provider.getTreeItem(children[0])).toBe(children[0]);
    store.dispose();
  });

  it('fires onDidChangeTreeData on refresh', () => {
    const store = new DiaryStore();
    const provider = new ChangePlanProvider(store);
    let fired = false;
    provider.onDidChangeTreeData(() => { fired = true; });
    provider.refresh();
    expect(fired).toBe(true);
    store.dispose();
  });

  it('refreshes automatically when store changes', () => {
    const store = new DiaryStore();
    const provider = new ChangePlanProvider(store);
    let fired = 0;
    provider.onDidChangeTreeData(() => { fired++; });
    store.addAnnotation(makeAnnotation());
    expect(fired).toBeGreaterThan(0);
    store.dispose();
  });

  it('annotation nodes have correct contextValue', () => {
    const store = new DiaryStore();
    store.addAnnotation(makeAnnotation());
    const provider = new ChangePlanProvider(store);
    const fileNodes = provider.getChildren();
    const annNodes = provider.getChildren(fileNodes[0]);
    expect((annNodes[0] as any).contextValue).toBe('annotation');
    store.dispose();
  });

  it('file nodes have correct description', () => {
    const store = new DiaryStore();
    store.addAnnotation(makeAnnotation({ id: 'a1' }));
    store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/foo.ts' }));
    const provider = new ChangePlanProvider(store);
    const fileNodes = provider.getChildren();
    expect((fileNodes[0] as any).description).toBe('2 annotations');
    store.dispose();
  });

  it('file node description is singular for 1 annotation', () => {
    const store = new DiaryStore();
    store.addAnnotation(makeAnnotation());
    const provider = new ChangePlanProvider(store);
    const fileNodes = provider.getChildren();
    expect((fileNodes[0] as any).description).toBe('1 annotation');
    store.dispose();
  });

  it('filters by file path', () => {
    const store = new DiaryStore();
    store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/auth/login.ts' }));
    store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/billing/charge.ts' }));
    store.addAnnotation(makeAnnotation({ id: 'a3', file: 'src/auth/tokens.ts' }));
    const provider = new ChangePlanProvider(store);

    provider.setPathFilter('src/auth');
    const filtered = provider.getChildren();
    expect(filtered).toHaveLength(2);
    const filePaths = filtered.map((c: any) => c.filePath).sort();
    expect(filePaths).toEqual(['src/auth/login.ts', 'src/auth/tokens.ts']);
    store.dispose();
  });

  it('path filter is case insensitive', () => {
    const store = new DiaryStore();
    store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/Auth/Login.ts' }));
    const provider = new ChangePlanProvider(store);

    provider.setPathFilter('auth');
    expect(provider.getChildren()).toHaveLength(1);
    store.dispose();
  });

  it('clears path filter with undefined', () => {
    const store = new DiaryStore();
    store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/auth/login.ts' }));
    store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/billing/charge.ts' }));
    const provider = new ChangePlanProvider(store);

    provider.setPathFilter('auth');
    expect(provider.getChildren()).toHaveLength(1);

    provider.setPathFilter(undefined);
    expect(provider.getChildren()).toHaveLength(2);
    store.dispose();
  });

  it('combines category and path filters', () => {
    const store = new DiaryStore();
    store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/auth/login.ts', category: 'verified' }));
    store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/auth/tokens.ts', category: 'needs_review' }));
    store.addAnnotation(makeAnnotation({ id: 'a3', file: 'src/billing/charge.ts', category: 'verified' }));
    const provider = new ChangePlanProvider(store);

    provider.setFilter('verified');
    provider.setPathFilter('src/auth');
    const filtered = provider.getChildren();
    expect(filtered).toHaveLength(1);
    expect((filtered[0] as any).filePath).toBe('src/auth/login.ts');
    store.dispose();
  });

  it('getActiveFilters returns current filter state', () => {
    const store = new DiaryStore();
    const provider = new ChangePlanProvider(store);

    expect(provider.getActiveFilters()).toEqual({ category: undefined, path: undefined });

    provider.setFilter('verified');
    provider.setPathFilter('src/auth');
    expect(provider.getActiveFilters()).toEqual({ category: 'verified', path: 'src/auth' });
    store.dispose();
  });

  it('annotation nodes cover all category color mappings', () => {
    const store = new DiaryStore();
    const categories = ['verified', 'needs_review', 'modified', 'confused', 'hallucination', 'intent', 'accepted'] as const;
    categories.forEach((cat, i) => {
      store.addAnnotation(makeAnnotation({ id: `a${i}`, category: cat, file: 'src/foo.ts' }));
    });
    const provider = new ChangePlanProvider(store);
    const fileNodes = provider.getChildren();
    const annotationNodes = provider.getChildren(fileNodes[0]);
    expect(annotationNodes).toHaveLength(7);
    // Each node should have an iconPath with a color
    for (const node of annotationNodes) {
      expect((node as any).iconPath).toBeDefined();
      expect((node as any).iconPath.color).toBeDefined();
    }
    store.dispose();
  });
});
