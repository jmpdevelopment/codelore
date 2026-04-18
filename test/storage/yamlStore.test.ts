import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { YamlStore } from '../../src/storage/yamlStore';
import { Annotation } from '../../src/models/annotation';
import { ReviewMarker } from '../../src/models/reviewMarker';
import { CriticalFlag } from '../../src/models/criticalFlag';

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

function makeMarker(overrides: Partial<ReviewMarker> = {}): ReviewMarker {
  return {
    file: 'src/foo.ts',
    line_start: 1,
    line_end: 10,
    reviewer: 'alice',
    reviewed_at: '2026-01-01T00:00:00Z',
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-test-'));
  fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
  __setWorkspaceFolder(tmpDir);
  __setConfig({ 'codediary.storagePath': '.vscode/codediary.yaml' });
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
      expect(store.getReviewMarkers()).toEqual([]);
      expect(store.getCriticalFlags()).toEqual([]);
      expect(store.getNarrative()).toBeUndefined();
      store.dispose();
    });

    it('loads existing data from YAML file', () => {
      const yamlContent = `annotations:
  - id: ann-1
    file: src/foo.ts
    line_start: 10
    line_end: 20
    category: verified
    text: Looks good
    source: manual
    created_at: "2026-01-01T00:00:00Z"
review_markers: []
critical_flags: []
`;
      fs.writeFileSync(path.join(tmpDir, '.vscode/codediary.yaml'), yamlContent);
      const store = new YamlStore();
      expect(store.getAnnotations()).toHaveLength(1);
      expect(store.getAnnotations()[0].id).toBe('ann-1');
      store.dispose();
    });

    it('handles malformed YAML gracefully', () => {
      fs.writeFileSync(path.join(tmpDir, '.vscode/codediary.yaml'), '{{invalid yaml');
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

  describe('review markers', () => {
    it('adds and retrieves markers', () => {
      const store = new YamlStore();
      store.addReviewMarker(makeMarker());
      expect(store.getReviewMarkers()).toHaveLength(1);
      store.dispose();
    });

    it('filters markers by file', () => {
      const store = new YamlStore();
      store.addReviewMarker(makeMarker({ file: 'a.ts' }));
      store.addReviewMarker(makeMarker({ file: 'b.ts' }));
      expect(store.getReviewMarkersForFile('a.ts')).toHaveLength(1);
      expect(store.getReviewMarkersForFile('c.ts')).toHaveLength(0);
      store.dispose();
    });

    it('merges overlapping markers for same file', () => {
      const store = new YamlStore();
      store.addReviewMarker(makeMarker({ line_start: 1, line_end: 10 }));
      store.addReviewMarker(makeMarker({ line_start: 8, line_end: 20 }));
      const markers = store.getReviewMarkersForFile('src/foo.ts');
      expect(markers).toHaveLength(1);
      expect(markers[0].line_start).toBe(1);
      expect(markers[0].line_end).toBe(20);
      store.dispose();
    });

    it('does not merge non-overlapping markers', () => {
      const store = new YamlStore();
      store.addReviewMarker(makeMarker({ line_start: 1, line_end: 5 }));
      store.addReviewMarker(makeMarker({ line_start: 20, line_end: 30 }));
      const markers = store.getReviewMarkersForFile('src/foo.ts');
      expect(markers).toHaveLength(2);
      store.dispose();
    });

    it('removes specific marker', () => {
      const store = new YamlStore();
      store.addReviewMarker(makeMarker({ line_start: 1, line_end: 5 }));
      store.addReviewMarker(makeMarker({ line_start: 20, line_end: 30 }));
      store.removeReviewMarker('src/foo.ts', 1, 5);
      expect(store.getReviewMarkersForFile('src/foo.ts')).toHaveLength(1);
      store.dispose();
    });

    it('removes all markers for file', () => {
      const store = new YamlStore();
      store.addReviewMarker(makeMarker({ line_start: 1, line_end: 5 }));
      store.addReviewMarker(makeMarker({ line_start: 20, line_end: 30 }));
      store.removeReviewMarkersForFile('src/foo.ts');
      expect(store.getReviewMarkersForFile('src/foo.ts')).toHaveLength(0);
      store.dispose();
    });

    it('isLineReviewed returns true for covered lines', () => {
      const store = new YamlStore();
      store.addReviewMarker(makeMarker({ line_start: 5, line_end: 10 }));
      expect(store.isLineReviewed('src/foo.ts', 5)).toBe(true);
      expect(store.isLineReviewed('src/foo.ts', 7)).toBe(true);
      expect(store.isLineReviewed('src/foo.ts', 10)).toBe(true);
      expect(store.isLineReviewed('src/foo.ts', 4)).toBe(false);
      expect(store.isLineReviewed('src/foo.ts', 11)).toBe(false);
      expect(store.isLineReviewed('other.ts', 7)).toBe(false);
      store.dispose();
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

  describe('narrative', () => {
    it('get/set narrative', () => {
      const store = new YamlStore();
      expect(store.getNarrative()).toBeUndefined();
      store.setNarrative('Refactoring auth module');
      expect(store.getNarrative()).toBe('Refactoring auth module');
      store.dispose();
    });

    it('persists narrative', () => {
      const store = new YamlStore();
      store.setNarrative('My narrative');
      store.dispose();

      const store2 = new YamlStore();
      expect(store2.getNarrative()).toBe('My narrative');
      store2.dispose();
    });
  });

  describe('clearAll', () => {
    it('clears all data', () => {
      const store = new YamlStore();
      store.addAnnotation(makeAnnotation());
      store.addReviewMarker(makeMarker());
      store.addCriticalFlag(makeFlag());
      store.setNarrative('test');
      store.clearAll();
      expect(store.getAnnotations()).toEqual([]);
      expect(store.getReviewMarkers()).toEqual([]);
      expect(store.getCriticalFlags()).toEqual([]);
      expect(store.getNarrative()).toBeUndefined();
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
      store.addReviewMarker(makeMarker());
      store.removeReviewMarker('src/foo.ts', 1, 10);
      store.removeReviewMarkersForFile('src/foo.ts');
      store.addCriticalFlag(makeFlag());
      store.updateCriticalFlag('src/foo.ts', 5, { human_reviewed: true });
      store.removeCriticalFlag('src/foo.ts', 5, 15);
      store.setNarrative('hi');
      store.clearAll();

      expect(fired).toBe(11);
      store.dispose();
    });
  });

  describe('schema version', () => {
    it('writes version: 2 at the top of the file', () => {
      const store = new YamlStore();
      store.addAnnotation(makeAnnotation());
      store.dispose();

      const raw = fs.readFileSync(path.join(tmpDir, '.vscode/codediary.yaml'), 'utf8');
      expect(raw.startsWith('version: 2\n')).toBe(true);
    });

    it('reads a v1 file (no version field) and upgrades on next write', () => {
      const v1 = `annotations:
  - id: ann-legacy
    file: src/foo.ts
    line_start: 1
    line_end: 2
    category: verified
    text: legacy
    source: manual
    created_at: "2026-01-01T00:00:00Z"
review_markers: []
critical_flags: []
`;
      fs.writeFileSync(path.join(tmpDir, '.vscode/codediary.yaml'), v1);

      const store = new YamlStore();
      expect(store.getAnnotations()).toHaveLength(1);
      expect(store.getAnnotations()[0].id).toBe('ann-legacy');

      store.addAnnotation(makeAnnotation({ id: 'ann-new' }));
      store.dispose();

      const raw = fs.readFileSync(path.join(tmpDir, '.vscode/codediary.yaml'), 'utf8');
      expect(raw).toMatch(/^version: 2\n/);
      expect(raw).not.toContain('version: 1');
    });

    it('reads a v2 file and preserves data', () => {
      const v2 = `version: 2
annotations:
  - id: ann-v2
    file: src/foo.ts
    line_start: 1
    line_end: 2
    category: verified
    text: v2 annotation
    source: manual
    created_at: "2026-01-01T00:00:00Z"
review_markers: []
critical_flags: []
`;
      fs.writeFileSync(path.join(tmpDir, '.vscode/codediary.yaml'), v2);

      const store = new YamlStore();
      expect(store.getAnnotations()).toHaveLength(1);
      expect(store.getAnnotations()[0].id).toBe('ann-v2');
      store.dispose();
    });

    it('normalizes legacy source values on load', () => {
      const legacy = `annotations:
  - id: a-manual
    file: src/foo.ts
    line_start: 1
    line_end: 2
    category: verified
    text: ok
    source: manual
    created_at: "2026-01-01T00:00:00Z"
  - id: a-suggested
    file: src/foo.ts
    line_start: 3
    line_end: 4
    category: verified
    text: ok
    source: ai_suggested
    created_at: "2026-01-01T00:00:00Z"
  - id: a-accepted
    file: src/foo.ts
    line_start: 5
    line_end: 6
    category: verified
    text: ok
    source: ai_accepted
    created_at: "2026-01-01T00:00:00Z"
review_markers: []
critical_flags: []
`;
      fs.writeFileSync(path.join(tmpDir, '.vscode/codediary.yaml'), legacy);

      const store = new YamlStore();
      const sources = store.getAnnotations().reduce<Record<string, string>>((acc, a) => {
        acc[a.id] = a.source;
        return acc;
      }, {});
      expect(sources['a-manual']).toBe('human_authored');
      expect(sources['a-suggested']).toBe('ai_generated');
      expect(sources['a-accepted']).toBe('ai_verified');
      store.dispose();
    });

    it('does not leak the version field into the annotation data', () => {
      const v2 = `version: 2
annotations:
  - id: ann-v2
    file: src/foo.ts
    line_start: 1
    line_end: 2
    category: verified
    text: hello
    source: manual
    created_at: "2026-01-01T00:00:00Z"
review_markers: []
critical_flags: []
`;
      fs.writeFileSync(path.join(tmpDir, '.vscode/codediary.yaml'), v2);

      const store = new YamlStore();
      const ann = store.getAnnotations()[0] as unknown as Record<string, unknown>;
      expect(ann).not.toHaveProperty('version');
      store.dispose();
    });
  });

  describe('save', () => {
    it('creates parent directory if it does not exist', () => {
      __setConfig({ 'codediary.storagePath': 'deep/nested/dir/codediary.yaml' });
      const store = new YamlStore();
      store.addAnnotation(makeAnnotation());
      const filePath = path.join(tmpDir, 'deep/nested/dir/codediary.yaml');
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
