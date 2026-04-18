import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  __setWorkspaceFolder,
  __clearWorkspace,
  __setConfig,
  __setActiveTextEditor,
  Uri,
} from '../__mocks__/vscode';
import { ComponentBar } from '../../src/views/componentBar';
import { LoreStore } from '../../src/storage/loreStore';
import { Component } from '../../src/models/component';

let tmpDir: string;

function writeComponent(dir: string, c: Component): void {
  const yaml = require('js-yaml');
  const file = path.join(dir, '.codelore', 'components', `${c.id}.yaml`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump({ version: 2, ...c }), 'utf8');
}

function editorFor(relPath: string): any {
  return {
    document: {
      uri: Uri.file(path.join(tmpDir, relPath)),
    },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelore-compbar-'));
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

describe('ComponentBar', () => {
  it('hides when there is no active editor', () => {
    __setActiveTextEditor(undefined);
    const store = new LoreStore();
    const bar = new ComponentBar(store);
    expect((bar as any).statusBarItem.visible).toBe(false);
    bar.dispose();
    store.dispose();
  });

  it('hides when the workspace has no components defined', () => {
    __setActiveTextEditor(editorFor('src/foo.ts'));
    const store = new LoreStore();
    const bar = new ComponentBar(store);
    expect((bar as any).statusBarItem.visible).toBe(false);
    bar.dispose();
    store.dispose();
  });

  it('shows "Untagged" when components exist but file has none', () => {
    writeComponent(tmpDir, {
      id: 'billing',
      name: 'Billing',
      files: ['src/billing/calc.ts'],
      source: 'human_authored',
      created_at: '2026-04-18T00:00:00Z',
      updated_at: '2026-04-18T00:00:00Z',
    });
    __setActiveTextEditor(editorFor('src/foo.ts'));
    const store = new LoreStore();
    const bar = new ComponentBar(store);
    bar.update();
    const item = (bar as any).statusBarItem;
    expect(item.visible).toBe(true);
    expect(item.text).toBe('$(symbol-namespace) Untagged');
    expect(item.command).toBe('codelore.manageComponentsForFile');
    bar.dispose();
    store.dispose();
  });

  it('shows the component name when file is tagged into one', () => {
    writeComponent(tmpDir, {
      id: 'billing',
      name: 'Billing',
      files: ['src/foo.ts'],
      source: 'human_authored',
      created_at: '2026-04-18T00:00:00Z',
      updated_at: '2026-04-18T00:00:00Z',
    });
    __setActiveTextEditor(editorFor('src/foo.ts'));
    const store = new LoreStore();
    const bar = new ComponentBar(store);
    bar.update();
    const item = (bar as any).statusBarItem;
    expect(item.text).toBe('$(symbol-namespace) Billing');
    bar.dispose();
    store.dispose();
  });

  it('shows a "+N" suffix when file is tagged into multiple components', () => {
    writeComponent(tmpDir, {
      id: 'billing', name: 'Billing', files: ['src/foo.ts'],
      source: 'human_authored',
      created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
    });
    writeComponent(tmpDir, {
      id: 'reporting', name: 'Reporting', files: ['src/foo.ts'],
      source: 'human_authored',
      created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
    });
    __setActiveTextEditor(editorFor('src/foo.ts'));
    const store = new LoreStore();
    const bar = new ComponentBar(store);
    bar.update();
    const text = (bar as any).statusBarItem.text;
    expect(text).toMatch(/^\$\(symbol-namespace\) (Billing|Reporting) \+1$/);
    bar.dispose();
    store.dispose();
  });

  it('hides when active file is outside the workspace', () => {
    writeComponent(tmpDir, {
      id: 'billing', name: 'Billing', files: ['src/foo.ts'],
      source: 'human_authored',
      created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
    });
    __setActiveTextEditor({ document: { uri: Uri.file('/tmp/outside.ts') } });
    const store = new LoreStore();
    const bar = new ComponentBar(store);
    bar.update();
    expect((bar as any).statusBarItem.visible).toBe(false);
    bar.dispose();
    store.dispose();
  });

  it('updates when a file is tagged after construction', () => {
    writeComponent(tmpDir, {
      id: 'billing', name: 'Billing', files: [],
      source: 'human_authored',
      created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
    });
    __setActiveTextEditor(editorFor('src/foo.ts'));
    const store = new LoreStore();
    const bar = new ComponentBar(store);
    bar.update();
    expect((bar as any).statusBarItem.text).toBe('$(symbol-namespace) Untagged');

    store.components.addFile('billing', 'src/foo.ts');
    bar.update();
    expect((bar as any).statusBarItem.text).toBe('$(symbol-namespace) Billing');
    bar.dispose();
    store.dispose();
  });
});
