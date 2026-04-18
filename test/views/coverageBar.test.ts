import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { CoverageBar } from '../../src/views/coverageBar';
import { LoreStore } from '../../src/storage/loreStore';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelore-cov-'));
  fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
  __setWorkspaceFolder(tmpDir);
  __setConfig({
    'codelore.storagePath': '.vscode/codelore.yaml',
    'codelore.defaultScope': 'shared',
  });
});

afterEach(() => {
  __clearWorkspace();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('CoverageBar', () => {
  it('shows default text when store is empty', () => {
    const store = new LoreStore();
    const bar = new CoverageBar(store);
    // Access the internal status bar item
    const text = (bar as any).statusBarItem.text;
    expect(text).toBe('$(notebook) CodeLore');
    bar.dispose();
    store.dispose();
  });

  it('shows annotation count', () => {
    const store = new LoreStore();
    store.addAnnotation({
      id: 'a1', file: 'src/foo.ts', line_start: 1, line_end: 10,
      category: 'verified', text: 'ok', source: 'human_authored', created_at: '2026-01-01T00:00:00Z',
    });
    const bar = new CoverageBar(store);
    const text = (bar as any).statusBarItem.text;
    expect(text).toContain('1 notes');
    bar.dispose();
    store.dispose();
  });

  it('shows critical count when unreviewed flags exist', () => {
    const store = new LoreStore();
    store.addAnnotation({
      id: 'a1', file: 'src/foo.ts', line_start: 1, line_end: 10,
      category: 'verified', text: 'ok', source: 'human_authored', created_at: '2026-01-01T00:00:00Z',
    });
    store.addCriticalFlag({
      file: 'src/foo.ts', line_start: 5, line_end: 15,
      severity: 'critical', human_reviewed: false,
    });
    store.addCriticalFlag({
      file: 'src/foo.ts', line_start: 20, line_end: 25,
      severity: 'high', human_reviewed: true,
    });
    const bar = new CoverageBar(store);
    const text = (bar as any).statusBarItem.text;
    expect(text).toContain('1 critical');
    bar.dispose();
    store.dispose();
  });

  it('does not show critical count when all are reviewed', () => {
    const store = new LoreStore();
    store.addAnnotation({
      id: 'a1', file: 'src/foo.ts', line_start: 1, line_end: 10,
      category: 'verified', text: 'ok', source: 'human_authored', created_at: '2026-01-01T00:00:00Z',
    });
    store.addCriticalFlag({
      file: 'src/foo.ts', line_start: 5, line_end: 15,
      severity: 'critical', human_reviewed: true,
    });
    const bar = new CoverageBar(store);
    const text = (bar as any).statusBarItem.text;
    expect(text).not.toContain('critical');
    bar.dispose();
    store.dispose();
  });

  it('updates when store changes', () => {
    const store = new LoreStore();
    const bar = new CoverageBar(store);
    expect((bar as any).statusBarItem.text).toBe('$(notebook) CodeLore');

    store.addAnnotation({
      id: 'a1', file: 'src/foo.ts', line_start: 1, line_end: 10,
      category: 'verified', text: 'ok', source: 'human_authored', created_at: '2026-01-01T00:00:00Z',
    });
    // After store change, text should update
    expect((bar as any).statusBarItem.text).toContain('1 notes');
    bar.dispose();
    store.dispose();
  });

  it('dispose cleans up', () => {
    const store = new LoreStore();
    const bar = new CoverageBar(store);
    // Should not throw
    bar.dispose();
    store.dispose();
  });

  it('click target is the annotations view', () => {
    const store = new LoreStore();
    const bar = new CoverageBar(store);
    expect((bar as any).statusBarItem.command).toBe('codelore.showChangePlan');
    bar.dispose();
    store.dispose();
  });
});
