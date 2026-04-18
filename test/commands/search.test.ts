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
    description: 'Auth token validation',
    human_reviewed: false,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-search-'));
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

describe('DiaryStore.search', () => {
  describe('text search', () => {
    it('finds annotations matching text', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', text: 'billing logic verified' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', text: 'auth flow looks fine' }));

      const results = store.search({ text: 'billing' });
      expect(results).toHaveLength(1);
      expect(results[0].label).toContain('billing logic verified');
      store.dispose();
    });

    it('is case insensitive', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', text: 'Billing Logic Verified' }));

      const results = store.search({ text: 'billing' });
      expect(results).toHaveLength(1);
      store.dispose();
    });

    it('returns all when text is empty', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', text: 'other' }));

      const results = store.search({ text: '' });
      expect(results).toHaveLength(2);
      store.dispose();
    });
  });

  describe('category filter', () => {
    it('filters by annotation category', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', category: 'verified' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', category: 'needs_review' }));
      store.addAnnotation(makeAnnotation({ id: 'a3', category: 'needs_review' }));

      const results = store.search({ category: 'needs_review' });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.type === 'annotation')).toBe(true);
      store.dispose();
    });

    it('excludes critical flags when category filter is set', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', category: 'verified' }));
      store.addCriticalFlag(makeFlag());

      const results = store.search({ category: 'verified' });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('annotation');
      store.dispose();
    });
  });

  describe('file filter', () => {
    it('filters by file path substring', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/auth/middleware.ts' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/billing/charge.ts' }));
      store.addAnnotation(makeAnnotation({ id: 'a3', file: 'src/auth/tokens.ts' }));

      const results = store.search({ file: 'src/auth' });
      expect(results).toHaveLength(2);
      store.dispose();
    });

    it('matches file name without directory', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/deep/nested/middleware.ts' }));

      const results = store.search({ file: 'middleware.ts' });
      expect(results).toHaveLength(1);
      store.dispose();
    });
  });

  describe('combined filters', () => {
    it('combines text and file filters', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/auth/login.ts', text: 'token expiry' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/billing/pay.ts', text: 'token usage' }));
      store.addAnnotation(makeAnnotation({ id: 'a3', file: 'src/auth/logout.ts', text: 'session clear' }));

      const results = store.search({ text: 'token', file: 'src/auth' });
      expect(results).toHaveLength(1);
      expect(results[0].file).toBe('src/auth/login.ts');
      store.dispose();
    });

    it('combines category and file filters', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/auth/login.ts', category: 'needs_review' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/auth/login.ts', category: 'verified' }));
      store.addAnnotation(makeAnnotation({ id: 'a3', file: 'src/billing/pay.ts', category: 'needs_review' }));

      const results = store.search({ category: 'needs_review', file: 'src/auth' });
      expect(results).toHaveLength(1);
      store.dispose();
    });
  });

  describe('critical flags in search', () => {
    it('includes critical flags with no category filter', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag());

      const results = store.search({});
      const critical = results.filter(r => r.type === 'critical_flag');
      expect(critical).toHaveLength(1);
      expect(critical[0].label).toContain('critical');
      store.dispose();
    });

    it('filters critical flags by text in description', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag({ description: 'Auth token validation' }));
      store.addCriticalFlag(makeFlag({ description: 'Payment processing', line_start: 50, line_end: 60 }));

      const results = store.search({ text: 'payment' });
      expect(results).toHaveLength(1);
      expect(results[0].label).toContain('Payment processing');
      store.dispose();
    });

    it('filters critical flags by file', () => {
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag({ file: 'src/auth/login.ts' }));
      store.addCriticalFlag(makeFlag({ file: 'src/billing/pay.ts', line_start: 50, line_end: 60 }));

      const results = store.search({ file: 'billing' });
      const critical = results.filter(r => r.type === 'critical_flag');
      expect(critical).toHaveLength(1);
      store.dispose();
    });
  });

  describe('scope tracking', () => {
    it('tracks shared vs personal scope in results', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1' }), 'shared');
      store.addAnnotation(makeAnnotation({ id: 'a2', text: 'private note' }), 'personal');

      const results = store.search({});
      const shared = results.filter(r => r.scope === 'shared');
      const personal = results.filter(r => r.scope === 'personal');
      expect(shared.length).toBeGreaterThanOrEqual(1);
      expect(personal.length).toBeGreaterThanOrEqual(1);
      store.dispose();
    });
  });

  describe('empty results', () => {
    it('returns empty array when no data', () => {
      const store = new DiaryStore();
      const results = store.search({ text: 'anything' });
      expect(results).toEqual([]);
      store.dispose();
    });

    it('returns empty array when nothing matches', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', text: 'billing' }));

      const results = store.search({ text: 'nonexistent' });
      expect(results).toEqual([]);
      store.dispose();
    });
  });
});
