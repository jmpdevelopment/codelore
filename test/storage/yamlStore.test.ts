import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { YamlStore } from '../../src/storage/yamlStore';
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelore-test-'));
  fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
  __setWorkspaceFolder(tmpDir);
  __setConfig({ 'codelore.storagePath': '.vscode/codelore.yaml' });
});

afterEach(() => {
  __clearWorkspace();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('YamlStore', () => {
  describe('constructor', () => {
    it('initializes with empty data when no file exists', () => {
      const store = new YamlStore();
      expect(store.getAnnotations()).toEqual([]);
      expect(store.getCriticalFlags()).toEqual([]);
      store.dispose();
    });

    it('loads existing data from YAML file', () => {
      const yamlContent = `version: 2
annotations:
  - id: ann-1
    file: src/foo.ts
    line_start: 10
    line_end: 20
    category: behavior
    text: Looks good
    source: human_authored
    created_at: "2026-01-01T00:00:00Z"
critical_flags: []
`;
      fs.writeFileSync(path.join(tmpDir, '.vscode/codelore.yaml'), yamlContent);
      const store = new YamlStore();
      expect(store.getAnnotations()).toHaveLength(1);
      expect(store.getAnnotations()[0].id).toBe('ann-1');
      store.dispose();
    });

    it('handles malformed YAML gracefully', () => {
      fs.writeFileSync(path.join(tmpDir, '.vscode/codelore.yaml'), '{{invalid yaml');
      const store = new YamlStore();
      expect(store.getAnnotations()).toEqual([]);
      store.dispose();
    });

    it('handles no workspace folder', () => {
      __clearWorkspace();
      const store = new YamlStore();
      expect(store.getAnnotations()).toEqual([]);
      store.dispose();
    });
  });

  describe('annotations', () => {
    it('adds and retrieves annotations', () => {
      const store = new YamlStore();
      const ann = makeAnnotation();
      store.addAnnotation(ann);
      expect(store.getAnnotations()).toHaveLength(1);
      expect(store.getAnnotations()[0]).toEqual(ann);
      store.dispose();
    });

    it('filters annotations by file', () => {
      const store = new YamlStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/foo.ts' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/bar.ts' }));
      expect(store.getAnnotationsForFile('src/foo.ts')).toHaveLength(1);
      expect(store.getAnnotationsForFile('src/bar.ts')).toHaveLength(1);
      expect(store.getAnnotationsForFile('src/baz.ts')).toHaveLength(0);
      store.dispose();
    });

    it('updates annotation', () => {
      const store = new YamlStore();
      store.addAnnotation(makeAnnotation());
      store.updateAnnotation('ann-1', { text: 'Updated text' });
      expect(store.getAnnotations()[0].text).toBe('Updated text');
      store.dispose();
    });

    it('update does nothing for non-existent id', () => {
      const store = new YamlStore();
      store.addAnnotation(makeAnnotation());
      store.updateAnnotation('non-existent', { text: 'nope' });
      expect(store.getAnnotations()[0].text).toBe('Looks good');
      store.dispose();
    });

    it('deletes annotation', () => {
      const store = new YamlStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }));
      store.addAnnotation(makeAnnotation({ id: 'a2' }));
      store.deleteAnnotation('a1');
      expect(store.getAnnotations()).toHaveLength(1);
      expect(store.getAnnotations()[0].id).toBe('a2');
      store.dispose();
    });

    it('persists annotations to YAML file', () => {
      const store = new YamlStore();
      store.addAnnotation(makeAnnotation());
      store.dispose();

      // Load fresh store to verify persistence
      const store2 = new YamlStore();
      expect(store2.getAnnotations()).toHaveLength(1);
      store2.dispose();
    });
  });

  describe('critical flags', () => {
    it('adds and retrieves flags', () => {
      const store = new YamlStore();
      store.addCriticalFlag(makeFlag());
      expect(store.getCriticalFlags()).toHaveLength(1);
      store.dispose();
    });

    it('filters flags by file', () => {
      const store = new YamlStore();
      store.addCriticalFlag(makeFlag({ file: 'a.ts' }));
      store.addCriticalFlag(makeFlag({ file: 'b.ts' }));
      expect(store.getCriticalFlagsForFile('a.ts')).toHaveLength(1);
      expect(store.getCriticalFlagsForFile('c.ts')).toHaveLength(0);
      store.dispose();
    });

    it('updates critical flag by file and lineStart', () => {
      const store = new YamlStore();
      store.addCriticalFlag(makeFlag({ description: 'original' }));
      store.updateCriticalFlag('src/foo.ts', 5, { human_reviewed: true, resolved_by: 'bob' });
      const flags = store.getCriticalFlags();
      expect(flags[0].human_reviewed).toBe(true);
      expect(flags[0].resolved_by).toBe('bob');
      store.dispose();
    });

    it('update does nothing for non-matching flag', () => {
      const store = new YamlStore();
      store.addCriticalFlag(makeFlag());
      store.updateCriticalFlag('src/foo.ts', 999, { human_reviewed: true });
      expect(store.getCriticalFlags()[0].human_reviewed).toBe(false);
      store.dispose();
    });

    it('removes critical flag', () => {
      const store = new YamlStore();
      store.addCriticalFlag(makeFlag({ line_start: 5, line_end: 15 }));
      store.addCriticalFlag(makeFlag({ line_start: 30, line_end: 40 }));
      store.removeCriticalFlag('src/foo.ts', 5, 15);
      expect(store.getCriticalFlags()).toHaveLength(1);
      expect(store.getCriticalFlags()[0].line_start).toBe(30);
      store.dispose();
    });
  });

  describe('clearAll', () => {
    it('clears all data', () => {
      const store = new YamlStore();
      store.addAnnotation(makeAnnotation());
      store.addCriticalFlag(makeFlag());
      store.clearAll();
      expect(store.getAnnotations()).toEqual([]);
      expect(store.getCriticalFlags()).toEqual([]);
      store.dispose();
    });
  });

  describe('events', () => {
    it('fires onDidChange when data changes', () => {
      const store = new YamlStore();
      let fired = 0;
      store.onDidChange(() => fired++);

      store.addAnnotation(makeAnnotation());
      store.updateAnnotation('ann-1', { text: 'new' });
      store.deleteAnnotation('ann-1');
      store.addCriticalFlag(makeFlag());
      store.updateCriticalFlag('src/foo.ts', 5, { human_reviewed: true });
      store.removeCriticalFlag('src/foo.ts', 5, 15);
      store.clearAll();

      expect(fired).toBe(7);
      store.dispose();
    });
  });

  describe('schema version', () => {
    it('writes version: 2 at the top of the file', () => {
      const store = new YamlStore();
      store.addAnnotation(makeAnnotation());
      store.dispose();

      const raw = fs.readFileSync(path.join(tmpDir, '.vscode/codelore.yaml'), 'utf8');
      expect(raw.startsWith('version: 2\n')).toBe(true);
    });

    it('rejects v1 files (no version field)', () => {
      const v1 = `annotations:
  - id: ann-legacy
    file: src/foo.ts
    line_start: 1
    line_end: 2
    category: verified
    text: legacy
    source: manual
    created_at: "2026-01-01T00:00:00Z"
critical_flags: []
`;
      fs.writeFileSync(path.join(tmpDir, '.vscode/codelore.yaml'), v1);

      const store = new YamlStore();
      // v1 files are not loaded; user sees an error message.
      expect(store.getAnnotations()).toEqual([]);
      store.dispose();
    });

    it('reads a v2 file and preserves data', () => {
      const v2 = `version: 2
annotations:
  - id: ann-v2
    file: src/foo.ts
    line_start: 1
    line_end: 2
    category: behavior
    text: v2 annotation
    source: human_authored
    created_at: "2026-01-01T00:00:00Z"
critical_flags: []
`;
      fs.writeFileSync(path.join(tmpDir, '.vscode/codelore.yaml'), v2);

      const store = new YamlStore();
      expect(store.getAnnotations()).toHaveLength(1);
      expect(store.getAnnotations()[0].id).toBe('ann-v2');
      store.dispose();
    });

    it('coerces unknown source values to human_authored on load', () => {
      const yamlContent = `version: 2
annotations:
  - id: a-bad
    file: src/foo.ts
    line_start: 1
    line_end: 2
    category: behavior
    text: ok
    source: something_weird
    created_at: "2026-01-01T00:00:00Z"
critical_flags: []
`;
      fs.writeFileSync(path.join(tmpDir, '.vscode/codelore.yaml'), yamlContent);

      const store = new YamlStore();
      expect(store.getAnnotations()[0].source).toBe('human_authored');
      store.dispose();
    });

    it('does not leak the version field into the annotation data', () => {
      const v2 = `version: 2
annotations:
  - id: ann-v2
    file: src/foo.ts
    line_start: 1
    line_end: 2
    category: behavior
    text: hello
    source: human_authored
    created_at: "2026-01-01T00:00:00Z"
critical_flags: []
`;
      fs.writeFileSync(path.join(tmpDir, '.vscode/codelore.yaml'), v2);

      const store = new YamlStore();
      const ann = store.getAnnotations()[0] as unknown as Record<string, unknown>;
      expect(ann).not.toHaveProperty('version');
      store.dispose();
    });
  });

  describe('save', () => {
    it('creates parent directory if it does not exist', () => {
      __setConfig({ 'codelore.storagePath': 'deep/nested/dir/codelore.yaml' });
      const store = new YamlStore();
      store.addAnnotation(makeAnnotation());
      const filePath = path.join(tmpDir, 'deep/nested/dir/codelore.yaml');
      expect(fs.existsSync(filePath)).toBe(true);
      store.dispose();
    });

    it('save does nothing without workspace', () => {
      __clearWorkspace();
      const store = new YamlStore();
      store.addAnnotation(makeAnnotation()); // Should not throw
      store.dispose();
    });
  });
});
