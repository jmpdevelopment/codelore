import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { LoreStore } from '../../src/storage/loreStore';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelore-qn-'));
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

describe('Quick Note behavior', () => {
  it('ai_prompt annotations are stored in personal scope', () => {
    const store = new LoreStore();
    store.addAnnotation({
      id: 'qn-1',
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 5,
      category: 'ai_prompt',
      text: 'Refactor this to use async/await',
      source: 'human_authored',
      created_at: new Date().toISOString(),
    }, 'personal');

    const annotations = store.getAnnotationsForFile('src/foo.ts');
    expect(annotations).toHaveLength(1);
    expect(annotations[0].category).toBe('ai_prompt');
    expect(annotations[0].text).toBe('Refactor this to use async/await');
    store.dispose();
  });

  it('ai_prompt category exists in store after add', () => {
    const store = new LoreStore();
    store.addAnnotation({
      id: 'qn-2',
      file: 'src/bar.ts',
      line_start: 10,
      line_end: 15,
      category: 'ai_prompt',
      text: 'Add error handling here',
      source: 'human_authored',
      created_at: new Date().toISOString(),
    }, 'personal');

    const all = store.getAnnotations();
    expect(all.some(a => a.category === 'ai_prompt')).toBe(true);
    store.dispose();
  });

  it('multiple quick notes on same file', () => {
    const store = new LoreStore();
    store.addAnnotation({
      id: 'qn-3',
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 5,
      category: 'ai_prompt',
      text: 'Note 1',
      source: 'human_authored',
      created_at: new Date().toISOString(),
    }, 'personal');
    store.addAnnotation({
      id: 'qn-4',
      file: 'src/foo.ts',
      line_start: 10,
      line_end: 20,
      category: 'ai_prompt',
      text: 'Note 2',
      source: 'human_authored',
      created_at: new Date().toISOString(),
    }, 'personal');

    expect(store.getAnnotationsForFile('src/foo.ts')).toHaveLength(2);
    store.dispose();
  });
});
