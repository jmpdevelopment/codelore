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
  it('human_note annotations persist under the chosen scope', () => {
    const store = new LoreStore();
    store.addAnnotation({
      id: 'qn-1',
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 5,
      category: 'human_note',
      text: 'Investigate why this branch was added',
      source: 'human_authored',
      created_at: new Date().toISOString(),
    }, 'shared');

    const annotations = store.getAnnotationsForFile('src/foo.ts');
    expect(annotations).toHaveLength(1);
    expect(annotations[0].category).toBe('human_note');
    expect(annotations[0].text).toBe('Investigate why this branch was added');
    store.dispose();
  });

  it('honours the personal scope when that is the default', () => {
    __setConfig({
      'codelore.storagePath': '.vscode/codelore.yaml',
      'codelore.defaultScope': 'personal',
    });
    const store = new LoreStore();
    store.addAnnotation({
      id: 'qn-2',
      file: 'src/bar.ts',
      line_start: 10,
      line_end: 15,
      category: 'human_note',
      text: 'Private reminder',
      source: 'human_authored',
      created_at: new Date().toISOString(),
    }, store.getDefaultScope());

    expect(store.personal.getAnnotations()).toHaveLength(1);
    expect(store.shared.getAnnotations()).toHaveLength(0);
    store.dispose();
  });

  it('multiple notes on the same file', () => {
    const store = new LoreStore();
    store.addAnnotation({
      id: 'qn-3',
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 5,
      category: 'human_note',
      text: 'Note 1',
      source: 'human_authored',
      created_at: new Date().toISOString(),
    }, 'shared');
    store.addAnnotation({
      id: 'qn-4',
      file: 'src/foo.ts',
      line_start: 10,
      line_end: 20,
      category: 'human_note',
      text: 'Note 2',
      source: 'human_authored',
      created_at: new Date().toISOString(),
    }, 'shared');

    expect(store.getAnnotationsForFile('src/foo.ts')).toHaveLength(2);
    store.dispose();
  });
});
