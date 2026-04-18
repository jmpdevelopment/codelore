import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { DiaryStore } from '../../src/storage/diaryStore';
import { Annotation } from '../../src/models/annotation';
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-diary-'));
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

describe('DiaryStore', () => {
  describe('scope routing', () => {
    it('defaults to shared scope', () => {
      const store = new DiaryStore();
      expect(store.getDefaultScope()).toBe('shared');
      store.dispose();
    });

    it('respects personal default scope config', () => {
      __setConfig({
        'codediary.storagePath': '.vscode/codediary.yaml',
        'codediary.defaultScope': 'personal',
      });
      const store = new DiaryStore();
      expect(store.getDefaultScope()).toBe('personal');
      store.dispose();
    });

    it('routes annotation to shared store by default', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation());
      expect(store.shared.getAnnotations()).toHaveLength(1);
      expect(store.personal.getAnnotations()).toHaveLength(0);
      store.dispose();
    });

    it('routes annotation to personal store when specified', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation(), 'personal');
      expect(store.shared.getAnnotations()).toHaveLength(0);
      expect(store.personal.getAnnotations()).toHaveLength(1);
      store.dispose();
    });

    it('routes critical flag based on scope', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag(), 'shared');
      store.addCriticalFlag(makeFlag({ file: 'b.ts' }), 'personal');
      expect(store.shared.getCriticalFlags()).toHaveLength(1);
      expect(store.personal.getCriticalFlags()).toHaveLength(1);
      store.dispose();
    });
  });

  describe('merged reads', () => {
    it('merges annotations from both stores', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }), 'shared');
      store.addAnnotation(makeAnnotation({ id: 'a2' }), 'personal');
      expect(store.getAnnotations()).toHaveLength(2);
      store.dispose();
    });

    it('merges annotations for file from both stores', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/foo.ts' }), 'shared');
      store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/foo.ts' }), 'personal');
      store.addAnnotation(makeAnnotation({ id: 'a3', file: 'other.ts' }), 'shared');
      expect(store.getAnnotationsForFile('src/foo.ts')).toHaveLength(2);
      store.dispose();
    });

    it('merges critical flags from both stores', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag({ file: 'a.ts' }), 'shared');
      store.addCriticalFlag(makeFlag({ file: 'b.ts' }), 'personal');
      expect(store.getCriticalFlags()).toHaveLength(2);
      store.dispose();
    });

    it('merges critical flags for file from both stores', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag({ line_start: 1, line_end: 5 }), 'shared');
      store.addCriticalFlag(makeFlag({ line_start: 20, line_end: 30 }), 'personal');
      expect(store.getCriticalFlagsForFile('src/foo.ts')).toHaveLength(2);
      store.dispose();
    });

  });

  describe('update/delete routing', () => {
    it('updates annotation in shared store', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }), 'shared');
      store.updateAnnotation('a1', { text: 'Updated' });
      expect(store.shared.getAnnotations()[0].text).toBe('Updated');
      store.dispose();
    });

    it('updates annotation in personal store when not in shared', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }), 'personal');
      store.updateAnnotation('a1', { text: 'Updated' });
      expect(store.personal.getAnnotations()[0].text).toBe('Updated');
      store.dispose();
    });

    it('deletes annotation from shared store', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }), 'shared');
      store.deleteAnnotation('a1');
      expect(store.getAnnotations()).toHaveLength(0);
      store.dispose();
    });

    it('deletes annotation from personal store when not in shared', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }), 'personal');
      store.deleteAnnotation('a1');
      expect(store.getAnnotations()).toHaveLength(0);
      store.dispose();
    });

    it('updates critical flag in shared store first', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag(), 'shared');
      store.updateCriticalFlag('src/foo.ts', 5, { human_reviewed: true });
      expect(store.shared.getCriticalFlags()[0].human_reviewed).toBe(true);
      store.dispose();
    });

    it('updates critical flag in personal when not in shared', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag(), 'personal');
      store.updateCriticalFlag('src/foo.ts', 5, { human_reviewed: true });
      expect(store.personal.getCriticalFlags()[0].human_reviewed).toBe(true);
      store.dispose();
    });

    it('removes critical flag from both stores', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag(), 'shared');
      store.addCriticalFlag(makeFlag(), 'personal');
      store.removeCriticalFlag('src/foo.ts', 5, 15);
      expect(store.getCriticalFlags()).toHaveLength(0);
      store.dispose();
    });

  });

  describe('getAnnotationScope', () => {
    it('returns shared when annotation is in shared store', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }), 'shared');
      expect(store.getAnnotationScope('a1')).toBe('shared');
      store.dispose();
    });

    it('returns personal when annotation is not in shared store', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }), 'personal');
      expect(store.getAnnotationScope('a1')).toBe('personal');
      store.dispose();
    });
  });

  describe('narrative', () => {
    it('stores narrative in personal store only', () => {
      const store = new DiaryStore();
      store.setNarrative('My narrative');
      expect(store.getNarrative()).toBe('My narrative');
      expect(store.personal.getNarrative()).toBe('My narrative');
      store.dispose();
    });
  });

  describe('clearAll', () => {
    it('only clears personal store', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }), 'shared');
      store.addAnnotation(makeAnnotation({ id: 'a2' }), 'personal');
      store.clearAll();
      expect(store.shared.getAnnotations()).toHaveLength(1);
      expect(store.personal.getAnnotations()).toHaveLength(0);
      store.dispose();
    });
  });

  describe('findOverlapping', () => {
    it('finds annotations that overlap the given range', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', line_start: 10, line_end: 20 }));
      store.addAnnotation(makeAnnotation({ id: 'a2', line_start: 15, line_end: 25 }));
      store.addAnnotation(makeAnnotation({ id: 'a3', line_start: 30, line_end: 40 }));

      const overlapping = store.findOverlapping('src/foo.ts', 18, 22);
      expect(overlapping).toHaveLength(2);
      expect(overlapping.map(a => a.id).sort()).toEqual(['a1', 'a2']);
      store.dispose();
    });

    it('returns empty when no overlap', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', line_start: 10, line_end: 20 }));

      const overlapping = store.findOverlapping('src/foo.ts', 25, 30);
      expect(overlapping).toHaveLength(0);
      store.dispose();
    });

    it('detects exact range match', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', line_start: 10, line_end: 20 }));

      const overlapping = store.findOverlapping('src/foo.ts', 10, 20);
      expect(overlapping).toHaveLength(1);
      store.dispose();
    });

    it('detects partial overlap at start', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', line_start: 10, line_end: 20 }));

      const overlapping = store.findOverlapping('src/foo.ts', 5, 12);
      expect(overlapping).toHaveLength(1);
      store.dispose();
    });

    it('detects partial overlap at end', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', line_start: 10, line_end: 20 }));

      const overlapping = store.findOverlapping('src/foo.ts', 18, 30);
      expect(overlapping).toHaveLength(1);
      store.dispose();
    });

    it('detects containment (new range contains existing)', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', line_start: 12, line_end: 18 }));

      const overlapping = store.findOverlapping('src/foo.ts', 10, 20);
      expect(overlapping).toHaveLength(1);
      store.dispose();
    });

    it('detects containment (existing contains new range)', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', line_start: 5, line_end: 30 }));

      const overlapping = store.findOverlapping('src/foo.ts', 10, 20);
      expect(overlapping).toHaveLength(1);
      store.dispose();
    });

    it('does not match annotations in other files', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/other.ts', line_start: 10, line_end: 20 }));

      const overlapping = store.findOverlapping('src/foo.ts', 10, 20);
      expect(overlapping).toHaveLength(0);
      store.dispose();
    });

    it('finds overlapping across both stores', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', line_start: 10, line_end: 20 }), 'shared');
      store.addAnnotation(makeAnnotation({ id: 'a2', line_start: 15, line_end: 25 }), 'personal');

      const overlapping = store.findOverlapping('src/foo.ts', 12, 18);
      expect(overlapping).toHaveLength(2);
      store.dispose();
    });

    it('handles single-line annotations', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', line_start: 15, line_end: 15 }));

      expect(store.findOverlapping('src/foo.ts', 15, 15)).toHaveLength(1);
      expect(store.findOverlapping('src/foo.ts', 10, 15)).toHaveLength(1);
      expect(store.findOverlapping('src/foo.ts', 15, 20)).toHaveLength(1);
      expect(store.findOverlapping('src/foo.ts', 16, 20)).toHaveLength(0);
      store.dispose();
    });

    it('handles adjacent ranges (no overlap)', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', line_start: 10, line_end: 14 }));

      // Line 15 starts right after line 14 ends — no overlap
      const overlapping = store.findOverlapping('src/foo.ts', 15, 20);
      expect(overlapping).toHaveLength(0);
      store.dispose();
    });
  });

  describe('findOverlappingCriticalFlags', () => {
    it('finds critical flags that overlap the given range', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag({ line_start: 10, line_end: 20 }));
      store.addCriticalFlag(makeFlag({ line_start: 15, line_end: 25 }));
      store.addCriticalFlag(makeFlag({ line_start: 30, line_end: 40 }));

      const overlapping = store.findOverlappingCriticalFlags('src/foo.ts', 18, 22);
      expect(overlapping).toHaveLength(2);
      store.dispose();
    });

    it('returns empty when no overlap', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag({ line_start: 10, line_end: 20 }));

      const overlapping = store.findOverlappingCriticalFlags('src/foo.ts', 25, 30);
      expect(overlapping).toHaveLength(0);
      store.dispose();
    });

    it('does not match flags in other files', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag({ file: 'src/other.ts', line_start: 10, line_end: 20 }));

      const overlapping = store.findOverlappingCriticalFlags('src/foo.ts', 10, 20);
      expect(overlapping).toHaveLength(0);
      store.dispose();
    });

    it('finds overlapping across both stores', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag({ line_start: 10, line_end: 20 }), 'shared');
      store.addCriticalFlag(makeFlag({ line_start: 15, line_end: 25 }), 'personal');

      const overlapping = store.findOverlappingCriticalFlags('src/foo.ts', 12, 18);
      expect(overlapping).toHaveLength(2);
      store.dispose();
    });

    it('detects exact range match', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag({ line_start: 10, line_end: 20 }));

      const overlapping = store.findOverlappingCriticalFlags('src/foo.ts', 10, 20);
      expect(overlapping).toHaveLength(1);
      store.dispose();
    });
  });

  describe('events', () => {
    it('fires onDidChange when either store changes', () => {
      const store = new DiaryStore();
      let fired = 0;
      store.onDidChange(() => fired++);
      store.addAnnotation(makeAnnotation({ id: 'a1' }), 'shared');
      store.addAnnotation(makeAnnotation({ id: 'a2' }), 'personal');
      expect(fired).toBe(2);
      store.dispose();
    });

    it('fires onDidChange when components change', () => {
      const store = new DiaryStore();
      let fired = 0;
      store.onDidChange(() => fired++);
      store.components.upsert({
        id: 'billing',
        name: 'Billing',
        files: [],
        source: 'human_authored',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      });
      expect(fired).toBe(1);
      store.dispose();
    });
  });

  describe('components', () => {
    it('exposes components via the facade', () => {
      const store = new DiaryStore();
      store.components.upsert({
        id: 'billing',
        name: 'Billing',
        files: ['src/billing/calc.ts'],
        source: 'human_authored',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      });

      expect(store.getComponents()).toHaveLength(1);
      expect(store.getComponent('billing')?.name).toBe('Billing');
      expect(store.getComponent('missing')).toBeUndefined();
      store.dispose();
    });

    it('builds a reverse file→components index', () => {
      const store = new DiaryStore();
      store.components.upsert({
        id: 'billing', name: 'Billing',
        files: ['src/shared.ts', 'src/billing/calc.ts'],
        source: 'human_authored',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      });
      store.components.upsert({
        id: 'reporting', name: 'Reporting',
        files: ['src/shared.ts', 'src/reports.ts'],
        source: 'human_authored',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      });

      const shared = store.getComponentsForFile('src/shared.ts').map(c => c.id).sort();
      expect(shared).toEqual(['billing', 'reporting']);

      expect(store.getComponentsForFile('src/billing/calc.ts').map(c => c.id)).toEqual(['billing']);
      expect(store.getComponentsForFile('src/untracked.ts')).toEqual([]);
      store.dispose();
    });

    it('getComponentTaggedFiles returns all files across components', () => {
      const store = new DiaryStore();
      store.components.upsert({
        id: 'a', name: 'A',
        files: ['src/a1.ts', 'src/a2.ts'],
        source: 'human_authored',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      });
      store.components.upsert({
        id: 'b', name: 'B',
        files: ['src/a2.ts', 'src/b1.ts'],
        source: 'human_authored',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      });

      const files = store.getComponentTaggedFiles().sort();
      expect(files).toEqual(['src/a1.ts', 'src/a2.ts', 'src/b1.ts']);
      store.dispose();
    });

    it('invalidates the index when components change', () => {
      const store = new DiaryStore();
      store.components.upsert({
        id: 'billing', name: 'Billing',
        files: ['src/a.ts'],
        source: 'human_authored',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      });
      expect(store.getComponentsForFile('src/a.ts')).toHaveLength(1);

      store.components.addFile('billing', 'src/b.ts');
      expect(store.getComponentsForFile('src/b.ts')).toHaveLength(1);

      store.components.removeFile('billing', 'src/a.ts');
      expect(store.getComponentsForFile('src/a.ts')).toEqual([]);
      store.dispose();
    });
  });
});
