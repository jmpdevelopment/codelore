import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { DiaryStore } from '../../src/storage/diaryStore';
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
    source: 'manual',
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

    it('routes review marker based on scope', () => {
      const store = new DiaryStore();
      store.addReviewMarker(makeMarker(), 'shared');
      store.addReviewMarker(makeMarker({ file: 'b.ts' }), 'personal');
      expect(store.shared.getReviewMarkers()).toHaveLength(1);
      expect(store.personal.getReviewMarkers()).toHaveLength(1);
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

    it('merges review markers from both stores', () => {
      const store = new DiaryStore();
      store.addReviewMarker(makeMarker({ file: 'a.ts' }), 'shared');
      store.addReviewMarker(makeMarker({ file: 'b.ts' }), 'personal');
      expect(store.getReviewMarkers()).toHaveLength(2);
      store.dispose();
    });

    it('merges review markers for file from both stores', () => {
      const store = new DiaryStore();
      store.addReviewMarker(makeMarker({ line_start: 1, line_end: 5 }), 'shared');
      store.addReviewMarker(makeMarker({ line_start: 20, line_end: 30 }), 'personal');
      expect(store.getReviewMarkersForFile('src/foo.ts')).toHaveLength(2);
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

    it('isLineReviewed checks both stores', () => {
      const store = new DiaryStore();
      store.addReviewMarker(makeMarker({ line_start: 1, line_end: 5 }), 'shared');
      store.addReviewMarker(makeMarker({ line_start: 20, line_end: 30 }), 'personal');
      expect(store.isLineReviewed('src/foo.ts', 3)).toBe(true);
      expect(store.isLineReviewed('src/foo.ts', 25)).toBe(true);
      expect(store.isLineReviewed('src/foo.ts', 10)).toBe(false);
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

    it('removes review marker from both stores', () => {
      const store = new DiaryStore();
      store.addReviewMarker(makeMarker({ line_start: 1, line_end: 10 }), 'shared');
      store.addReviewMarker(makeMarker({ line_start: 1, line_end: 10 }), 'personal');
      store.removeReviewMarker('src/foo.ts', 1, 10);
      expect(store.getReviewMarkers()).toHaveLength(0);
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

  describe('removeReviewMarkersForFile', () => {
    it('only removes personal markers', () => {
      const store = new DiaryStore();
      store.addReviewMarker(makeMarker(), 'shared');
      store.addReviewMarker(makeMarker({ line_start: 20, line_end: 30 }), 'personal');
      store.removeReviewMarkersForFile('src/foo.ts');
      expect(store.shared.getReviewMarkersForFile('src/foo.ts')).toHaveLength(1);
      expect(store.personal.getReviewMarkersForFile('src/foo.ts')).toHaveLength(0);
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
  });
});
