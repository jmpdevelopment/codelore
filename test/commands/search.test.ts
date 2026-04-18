import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { DiaryStore } from '../../src/storage/diaryStore';
import { Annotation } from '../../src/models/annotation';
import { CriticalFlag } from '../../src/models/criticalFlag';
import { Component } from '../../src/models/component';

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
      store.addAnnotation(makeAnnotation({ id: 'a1', category: 'behavior' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', category: 'gotcha' }));
      store.addAnnotation(makeAnnotation({ id: 'a3', category: 'gotcha' }));

      const results = store.search({ category: 'gotcha' });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.type === 'annotation')).toBe(true);
      store.dispose();
    });

    it('excludes critical flags when category filter is set', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', category: 'behavior' }));
      store.addCriticalFlag(makeFlag());

      const results = store.search({ category: 'behavior' });
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
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/auth/login.ts', category: 'gotcha' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/auth/login.ts', category: 'behavior' }));
      store.addAnnotation(makeAnnotation({ id: 'a3', file: 'src/billing/pay.ts', category: 'gotcha' }));

      const results = store.search({ category: 'gotcha', file: 'src/auth' });
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

  describe('component filter', () => {
    function seedComponent(c: Partial<Component> & { id: string; name: string; files: string[] }): void {
      const yaml = require('js-yaml');
      const full = {
        version: 2,
        id: c.id,
        name: c.name,
        files: c.files,
        source: c.source ?? 'human_authored',
        created_at: c.created_at ?? '2026-04-18T00:00:00Z',
        updated_at: c.updated_at ?? '2026-04-18T00:00:00Z',
      };
      const file = path.join(tmpDir, '.codediary', 'components', `${c.id}.yaml`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, yaml.dump(full), 'utf8');
    }

    it('matches annotations on files that belong to the component', () => {
      seedComponent({ id: 'billing', name: 'Billing', files: ['src/billing/calc.ts'] });
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/billing/calc.ts' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/auth/login.ts' }));

      const results = store.search({ component: 'billing' });
      expect(results).toHaveLength(1);
      expect(results[0].file).toBe('src/billing/calc.ts');
      store.dispose();
    });

    it('matches annotations explicitly tagged with the component even on untagged files', () => {
      seedComponent({ id: 'billing', name: 'Billing', files: [] });
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({
        id: 'a1', file: 'src/anywhere.ts', components: ['billing'],
      }));
      store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/anywhere.ts' }));

      const results = store.search({ component: 'billing' });
      expect(results).toHaveLength(1);
      expect(results[0].label).toContain(makeAnnotation().text);
      store.dispose();
    });

    it('returns nothing when the component does not exist', () => {
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/billing/calc.ts' }));

      expect(store.search({ component: 'nonexistent' })).toEqual([]);
      store.dispose();
    });

    it('restricts critical flags to files in the component', () => {
      seedComponent({ id: 'billing', name: 'Billing', files: ['src/billing/calc.ts'] });
      const store = new DiaryStore();
      store.addCriticalFlag(makeFlag({ file: 'src/billing/calc.ts', description: 'invariant' }));
      store.addCriticalFlag(makeFlag({ file: 'src/auth/login.ts', description: 'token check', line_start: 30, line_end: 40 }));

      const results = store.search({ component: 'billing' });
      const critical = results.filter(r => r.type === 'critical_flag');
      expect(critical).toHaveLength(1);
      expect(critical[0].file).toBe('src/billing/calc.ts');
      store.dispose();
    });

    it('combines with text filter', () => {
      seedComponent({ id: 'billing', name: 'Billing', files: ['src/billing/a.ts', 'src/billing/b.ts'] });
      const store = new DiaryStore();
      store.addAnnotation(makeAnnotation({ id: 'a1', file: 'src/billing/a.ts', text: 'invoice rounding' }));
      store.addAnnotation(makeAnnotation({ id: 'a2', file: 'src/billing/b.ts', text: 'tax math' }));
      store.addAnnotation(makeAnnotation({ id: 'a3', file: 'src/auth/login.ts', text: 'invoice handler' }));

      const results = store.search({ component: 'billing', text: 'invoice' });
      expect(results).toHaveLength(1);
      expect(results[0].file).toBe('src/billing/a.ts');
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
