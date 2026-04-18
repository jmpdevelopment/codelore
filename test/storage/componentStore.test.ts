import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { __setWorkspaceFolder, __clearWorkspace } from '../__mocks__/vscode';
import { ComponentStore } from '../../src/storage/componentStore';
import { Component } from '../../src/models/component';
import { SCHEMA_VERSION } from '../../src/storage/schema';

let tmpDir: string;

function makeComponent(overrides: Partial<Component> = {}): Component {
  const now = '2026-04-18T00:00:00Z';
  return {
    id: 'billing',
    name: 'Billing Engine',
    files: [],
    source: 'human_authored',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-component-'));
  __setWorkspaceFolder(tmpDir);
});

afterEach(() => {
  __clearWorkspace();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ComponentStore', () => {
  describe('constructor', () => {
    it('initializes empty when .codediary/components/ does not exist', () => {
      const store = new ComponentStore();
      expect(store.getAll()).toEqual([]);
      store.dispose();
    });

    it('loads existing YAML files', () => {
      const dir = path.join(tmpDir, '.codediary', 'components');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'billing.yaml'),
        yaml.dump({
          version: 2,
          id: 'billing',
          name: 'Billing Engine',
          description: 'Invoice pipeline',
          files: ['src/billing/calc.ts'],
          source: 'human_authored',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }),
      );

      const store = new ComponentStore();
      expect(store.getAll()).toHaveLength(1);
      const c = store.get('billing');
      expect(c?.name).toBe('Billing Engine');
      expect(c?.files).toEqual(['src/billing/calc.ts']);
      store.dispose();
    });

    it('skips malformed YAML files', () => {
      const dir = path.join(tmpDir, '.codediary', 'components');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'broken.yaml'), '!!! not: [valid yaml');
      fs.writeFileSync(path.join(dir, 'valid.yaml'), yaml.dump({
        id: 'valid',
        name: 'Valid',
        files: [],
        source: 'human_authored',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }));

      const store = new ComponentStore();
      expect(store.getAll()).toHaveLength(1);
      expect(store.get('valid')).toBeDefined();
      store.dispose();
    });

    it('skips components with invalid ids', () => {
      const dir = path.join(tmpDir, '.codediary', 'components');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'bad.yaml'), yaml.dump({
        id: 'Not A Valid Slug',
        name: 'x',
        files: [],
        source: 'human_authored',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }));

      const store = new ComponentStore();
      expect(store.getAll()).toHaveLength(0);
      store.dispose();
    });

    it('tolerates legacy v1 YAML without version field', () => {
      const dir = path.join(tmpDir, '.codediary', 'components');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'auth.yaml'),
        yaml.dump({
          id: 'auth',
          name: 'Auth',
          files: [],
          source: 'human_authored',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }),
      );

      const store = new ComponentStore();
      expect(store.get('auth')).toBeDefined();
      store.dispose();
    });
  });

  describe('upsert', () => {
    it('creates a new component YAML file with version marker', () => {
      const store = new ComponentStore();
      store.upsert(makeComponent({ id: 'billing' }));

      const filePath = path.join(tmpDir, '.codediary', 'components', 'billing.yaml');
      expect(fs.existsSync(filePath)).toBe(true);
      const parsed = yaml.load(fs.readFileSync(filePath, 'utf8')) as any;
      expect(parsed.version).toBe(SCHEMA_VERSION);
      expect(parsed.id).toBe('billing');
      expect(parsed.name).toBe('Billing Engine');
      store.dispose();
    });

    it('updates an existing component and bumps updated_at', async () => {
      const store = new ComponentStore();
      store.upsert(makeComponent({ id: 'billing', created_at: '2026-01-01T00:00:00Z' }));
      const before = store.get('billing')!;

      // Wait a moment so updated_at actually differs
      await new Promise((r) => setTimeout(r, 10));
      store.upsert({ ...before, description: 'Updated' });

      const after = store.get('billing')!;
      expect(after.description).toBe('Updated');
      expect(after.created_at).toBe(before.created_at);
      expect(after.updated_at).not.toBe(before.updated_at);
      store.dispose();
    });

    it('rejects invalid ids', () => {
      const store = new ComponentStore();
      expect(() => store.upsert(makeComponent({ id: 'Bad Id' }))).toThrow(/invalid component id/i);
      store.dispose();
    });

    it('fires onDidChange', () => {
      const store = new ComponentStore();
      let fired = 0;
      store.onDidChange(() => { fired++; });
      store.upsert(makeComponent());
      expect(fired).toBe(1);
      store.dispose();
    });
  });

  describe('delete', () => {
    it('removes the YAML file and returns true', () => {
      const store = new ComponentStore();
      store.upsert(makeComponent({ id: 'billing' }));
      const filePath = path.join(tmpDir, '.codediary', 'components', 'billing.yaml');
      expect(fs.existsSync(filePath)).toBe(true);

      expect(store.delete('billing')).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);
      expect(store.get('billing')).toBeUndefined();
      store.dispose();
    });

    it('returns false for unknown id', () => {
      const store = new ComponentStore();
      expect(store.delete('nonexistent')).toBe(false);
      store.dispose();
    });
  });

  describe('addFile / removeFile', () => {
    it('adds a file to the components file list', () => {
      const store = new ComponentStore();
      store.upsert(makeComponent({ id: 'billing', files: [] }));
      store.addFile('billing', 'src/billing/calc.ts');

      expect(store.get('billing')?.files).toEqual(['src/billing/calc.ts']);
      store.dispose();
    });

    it('is a no-op when file already present', () => {
      const store = new ComponentStore();
      store.upsert(makeComponent({ id: 'billing', files: ['src/a.ts'] }));
      store.addFile('billing', 'src/a.ts');
      expect(store.get('billing')?.files).toEqual(['src/a.ts']);
      store.dispose();
    });

    it('throws when adding to unknown component', () => {
      const store = new ComponentStore();
      expect(() => store.addFile('missing', 'src/a.ts')).toThrow(/unknown component/i);
      store.dispose();
    });

    it('removes a file from the list', () => {
      const store = new ComponentStore();
      store.upsert(makeComponent({ id: 'billing', files: ['src/a.ts', 'src/b.ts'] }));
      store.removeFile('billing', 'src/a.ts');
      expect(store.get('billing')?.files).toEqual(['src/b.ts']);
      store.dispose();
    });

    it('removeFile is a no-op for missing component', () => {
      const store = new ComponentStore();
      expect(() => store.removeFile('missing', 'src/a.ts')).not.toThrow();
      store.dispose();
    });
  });

  describe('getComponentsForFile', () => {
    it('returns all components containing the given file', () => {
      const store = new ComponentStore();
      store.upsert(makeComponent({ id: 'billing', files: ['src/shared.ts', 'src/billing.ts'] }));
      store.upsert(makeComponent({ id: 'reporting', files: ['src/shared.ts', 'src/reports.ts'] }));
      store.upsert(makeComponent({ id: 'auth', files: ['src/auth.ts'] }));

      const shared = store.getComponentsForFile('src/shared.ts').map(c => c.id).sort();
      expect(shared).toEqual(['billing', 'reporting']);

      const auth = store.getComponentsForFile('src/auth.ts').map(c => c.id);
      expect(auth).toEqual(['auth']);

      expect(store.getComponentsForFile('src/unknown.ts')).toEqual([]);
      store.dispose();
    });
  });

  describe('persistence round-trip', () => {
    it('round-trips a component through disk', () => {
      const store1 = new ComponentStore();
      store1.upsert(makeComponent({
        id: 'billing',
        description: 'Invoice engine',
        owners: ['alice@example.com'],
        files: ['src/billing/calc.ts'],
      }));
      store1.dispose();

      const store2 = new ComponentStore();
      const loaded = store2.get('billing');
      expect(loaded?.description).toBe('Invoice engine');
      expect(loaded?.owners).toEqual(['alice@example.com']);
      expect(loaded?.files).toEqual(['src/billing/calc.ts']);
      store2.dispose();
    });
  });
});
