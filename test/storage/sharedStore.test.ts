import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace } from '../__mocks__/vscode';
import { SharedStore } from '../../src/storage/sharedStore';
import { Annotation } from '../../src/models/annotation';
import { CriticalFlag } from '../../src/models/criticalFlag';

let tmpDir: string;

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'ann-1',
    file: 'src/foo.ts',
    line_start: 10,
    line_end: 20,
    category: 'behavior',
    text: 'Looks good',
    source: 'human_authored',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-shared-'));
  __setWorkspaceFolder(tmpDir);
});

afterEach(() => {
  __clearWorkspace();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SharedStore', () => {
  describe('constructor', () => {
    it('initializes empty when .codediary/ does not exist', () => {
      const store = new SharedStore();
      expect(store.getAnnotations()).toEqual([]);
      expect(store.getCriticalFlags()).toEqual([]);
      store.dispose();
    });

    it('loads existing YAML files from .codediary/', () => {
      const yamlDir = path.join(tmpDir, '.codediary', 'src');
      fs.mkdirSync(yamlDir, { recursive: true });
      fs.writeFileSync(
        path.join(yamlDir, 'foo.ts.yaml'),
        'version: 2\nannotations:\n  - id: a1\n    file: src/foo.ts\n    line_start: 1\n    line_end: 5\n    category: behavior\n    text: ok\n    source: human_authored\n    created_at: "2026-01-01T00:00:00Z"\n',
      );
      const store = new SharedStore();
      expect(store.getAnnotations()).toHaveLength(1);
      expect(store.getAnnotations()[0].id).toBe('a1');
      store.dispose();
    });

    it('handles no workspace folder', () => {
      __clearWorkspace();
      const store = new SharedStore();
      expect(store.getAnnotations()).toEqual([]);
      store.dispose();
    });

    it('skips malformed YAML files', () => {
      const yamlDir = path.join(tmpDir, '.codediary', 'src');
      fs.mkdirSync(yamlDir, { recursive: true });
      fs.writeFileSync(path.join(yamlDir, 'bad.ts.yaml'), '{{not yaml');
      const store = new SharedStore();
      expect(store.getAnnotations()).toEqual([]);
      store.dispose();
    });
  });

  describe('annotations', () => {
    it('adds annotation and creates per-file YAML', () => {
      const store = new SharedStore();
      store.addAnnotation(makeAnnotation());
      expect(store.getAnnotations()).toHaveLength(1);

      const yamlPath = path.join(tmpDir, '.codediary', 'src', 'foo.ts.yaml');
      expect(fs.existsSync(yamlPath)).toBe(true);
      store.dispose();
    });

    it('getAnnotationsForFile returns only matching file', () => {
      const store = new SharedStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/foo.ts' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/bar.ts' }));
      expect(store.getAnnotationsForFile('src/foo.ts')).toHaveLength(1);
      expect(store.getAnnotationsForFile('src/bar.ts')).toHaveLength(1);
      expect(store.getAnnotationsForFile('nope.ts')).toHaveLength(0);
      store.dispose();
    });

    it('updates annotation', () => {
      const store = new SharedStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }));
      store.updateAnnotation('a1', { text: 'Updated' });
      expect(store.getAnnotations()[0].text).toBe('Updated');
      store.dispose();
    });

    it('update ignores non-existent annotation', () => {
      const store = new SharedStore();
      store.addAnnotation(makeAnnotation());
      store.updateAnnotation('nonexistent', { text: 'no' });
      expect(store.getAnnotations()[0].text).toBe('Looks good');
      store.dispose();
    });

    it('deletes annotation', () => {
      const store = new SharedStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/foo.ts' }));
      store.deleteAnnotation('a1');
      expect(store.getAnnotations()).toHaveLength(1);
      expect(store.getAnnotations()[0].id).toBe('a2');
      store.dispose();
    });

    it('delete ignores non-existent annotation', () => {
      const store = new SharedStore();
      store.addAnnotation(makeAnnotation());
      store.deleteAnnotation('nonexistent');
      expect(store.getAnnotations()).toHaveLength(1);
      store.dispose();
    });

    it('removes YAML file when last data is deleted', () => {
      const store = new SharedStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }));
      store.deleteAnnotation('a1');
      const yamlPath = path.join(tmpDir, '.codediary', 'src', 'foo.ts.yaml');
      expect(fs.existsSync(yamlPath)).toBe(false);
      store.dispose();
    });

    it('cleans up empty parent directories', () => {
      const store = new SharedStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'deep/nested/file.ts' }));
      store.deleteAnnotation('a1');
      expect(fs.existsSync(path.join(tmpDir, '.codediary', 'deep', 'nested'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, '.codediary', 'deep'))).toBe(false);
      store.dispose();
    });
  });

  describe('critical flags', () => {
    it('adds and retrieves flags', () => {
      const store = new SharedStore();
      store.addCriticalFlag(makeFlag());
      expect(store.getCriticalFlags()).toHaveLength(1);
      store.dispose();
    });

    it('filters flags by file', () => {
      const store = new SharedStore();
      store.addCriticalFlag(makeFlag({ file: 'a.ts' }));
      store.addCriticalFlag(makeFlag({ file: 'b.ts' }));
      expect(store.getCriticalFlagsForFile('a.ts')).toHaveLength(1);
      expect(store.getCriticalFlagsForFile('c.ts')).toHaveLength(0);
      store.dispose();
    });

    it('updates critical flag', () => {
      const store = new SharedStore();
      store.addCriticalFlag(makeFlag());
      store.updateCriticalFlag('src/foo.ts', 5, { human_reviewed: true });
      expect(store.getCriticalFlags()[0].human_reviewed).toBe(true);
      store.dispose();
    });

    it('update does nothing for non-matching flag', () => {
      const store = new SharedStore();
      store.addCriticalFlag(makeFlag());
      store.updateCriticalFlag('src/foo.ts', 999, { human_reviewed: true });
      expect(store.getCriticalFlags()[0].human_reviewed).toBe(false);
      store.dispose();
    });

    it('update does nothing when no flags exist', () => {
      const store = new SharedStore();
      store.updateCriticalFlag('src/foo.ts', 5, { human_reviewed: true });
      expect(store.getCriticalFlags()).toEqual([]);
      store.dispose();
    });

    it('removes critical flag', () => {
      const store = new SharedStore();
      store.addCriticalFlag(makeFlag({ line_start: 5, line_end: 15 }));
      store.addCriticalFlag(makeFlag({ line_start: 30, line_end: 40 }));
      store.removeCriticalFlag('src/foo.ts', 5, 15);
      expect(store.getCriticalFlags()).toHaveLength(1);
      store.dispose();
    });

    it('removes nothing when no flags exist', () => {
      const store = new SharedStore();
      store.removeCriticalFlag('src/foo.ts', 5, 15);
      expect(store.getCriticalFlags()).toEqual([]);
      store.dispose();
    });
  });

  describe('getAnnotatedFiles', () => {
    it('returns all file keys', () => {
      const store = new SharedStore();
      store.addAnnotation(makeAnnotation({ file: 'a.ts' }));
      store.addAnnotation(makeAnnotation({ id: 'b', file: 'b.ts' }));
      const files = store.getAnnotatedFiles();
      expect(files.sort()).toEqual(['a.ts', 'b.ts']);
      store.dispose();
    });
  });

  describe('persistence', () => {
    it('data survives across store instances', () => {
      const store1 = new SharedStore();
      store1.addAnnotation(makeAnnotation({ id: 'a1' }));
      store1.addCriticalFlag(makeFlag());
      store1.dispose();

      const store2 = new SharedStore();
      expect(store2.getAnnotations()).toHaveLength(1);
      expect(store2.getCriticalFlags()).toHaveLength(1);
      store2.dispose();
    });
  });

  describe('events', () => {
    it('fires onDidChange on mutations', () => {
      const store = new SharedStore();
      let fired = 0;
      store.onDidChange(() => fired++);

      store.addAnnotation(makeAnnotation());
      store.updateAnnotation('ann-1', { text: 'new' });
      store.deleteAnnotation('ann-1');
      store.addCriticalFlag(makeFlag());
      store.updateCriticalFlag('src/foo.ts', 5, { human_reviewed: true });
      store.removeCriticalFlag('src/foo.ts', 5, 15);

      expect(fired).toBe(6);
      store.dispose();
    });
  });

  describe('schema version', () => {
    it('writes version: 2 at the top of each per-file YAML', () => {
      const store = new SharedStore();
      store.addAnnotation(makeAnnotation({ file: 'src/foo.ts' }));
      store.dispose();

      const raw = fs.readFileSync(
        path.join(tmpDir, '.codediary', 'src', 'foo.ts.yaml'),
        'utf8',
      );
      expect(raw.startsWith('version: 2\n')).toBe(true);
    });

    it('loads a v2 file with the version field present', () => {
      const yamlDir = path.join(tmpDir, '.codediary', 'src');
      fs.mkdirSync(yamlDir, { recursive: true });
      fs.writeFileSync(
        path.join(yamlDir, 'modern.ts.yaml'),
        'version: 2\nannotations:\n  - id: modern\n    file: src/modern.ts\n    line_start: 1\n    line_end: 2\n    category: behavior\n    text: ok\n    source: human_authored\n    created_at: "2026-01-01T00:00:00Z"\n',
      );
      const store = new SharedStore();
      expect(store.getAnnotations()).toHaveLength(1);
      expect(store.getAnnotations()[0].id).toBe('modern');
      store.dispose();
    });

    it('rejects v1 files (no version field)', () => {
      const yamlDir = path.join(tmpDir, '.codediary', 'src');
      fs.mkdirSync(yamlDir, { recursive: true });
      fs.writeFileSync(
        path.join(yamlDir, 'legacy.ts.yaml'),
        'annotations:\n  - id: legacy\n    file: src/legacy.ts\n    line_start: 1\n    line_end: 2\n    category: verified\n    text: ok\n    source: manual\n    created_at: "2026-01-01T00:00:00Z"\n',
      );
      const store = new SharedStore();
      // v1 files are not loaded; user sees an error message.
      expect(store.getAnnotations()).toEqual([]);
      store.dispose();
    });

    it('coerces unknown source values to human_authored on load', () => {
      const yamlDir = path.join(tmpDir, '.codediary', 'src');
      fs.mkdirSync(yamlDir, { recursive: true });
      fs.writeFileSync(
        path.join(yamlDir, 'file.ts.yaml'),
        [
          'version: 2',
          'annotations:',
          '  - id: a-bad',
          '    file: src/file.ts',
          '    line_start: 1',
          '    line_end: 2',
          '    category: behavior',
          '    text: ok',
          '    source: something_weird',
          '    created_at: "2026-01-01T00:00:00Z"',
          '',
        ].join('\n'),
      );
      const store = new SharedStore();
      expect(store.getAnnotations()[0].source).toBe('human_authored');
      store.dispose();
    });

    it('does not leak the version field into cached annotation data', () => {
      const yamlDir = path.join(tmpDir, '.codediary', 'src');
      fs.mkdirSync(yamlDir, { recursive: true });
      fs.writeFileSync(
        path.join(yamlDir, 'modern.ts.yaml'),
        'version: 2\nannotations:\n  - id: modern\n    file: src/modern.ts\n    line_start: 1\n    line_end: 2\n    category: behavior\n    text: ok\n    source: human_authored\n    created_at: "2026-01-01T00:00:00Z"\n',
      );
      const store = new SharedStore();
      const ann = store.getAnnotations()[0] as unknown as Record<string, unknown>;
      expect(ann).not.toHaveProperty('version');
      store.dispose();
    });
  });

  describe('no workspace', () => {
    it('all write operations are no-ops without workspace', () => {
      __clearWorkspace();
      const store = new SharedStore();
      store.addAnnotation(makeAnnotation());
      store.addCriticalFlag(makeFlag());
      expect(store.getAnnotations()).toEqual([]);
      store.dispose();
    });
  });
});
