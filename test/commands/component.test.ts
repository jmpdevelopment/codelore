import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  __setWorkspaceFolder,
  __clearWorkspace,
  __setConfig,
  __queueQuickPick,
  __queueInputBox,
  __getExecutedCommands,
  __setActiveTextEditor,
  Uri,
} from '../__mocks__/vscode';
import * as vscode from '../__mocks__/vscode';
import { DiaryStore } from '../../src/storage/diaryStore';
import { registerComponentCommands } from '../../src/commands/component';
import { Component } from '../../src/models/component';

let tmpDir: string;
let context: any;

function seedComponent(c: Partial<Component> & { id: string; name: string }): void {
  const yaml = require('js-yaml');
  const full: Component = {
    id: c.id,
    name: c.name,
    description: c.description,
    owners: c.owners,
    files: c.files ?? [],
    source: c.source ?? 'human_authored',
    created_at: c.created_at ?? '2026-04-18T00:00:00Z',
    updated_at: c.updated_at ?? '2026-04-18T00:00:00Z',
    author: c.author,
  };
  const file = path.join(tmpDir, '.codediary', 'components', `${full.id}.yaml`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump({ version: 2, ...full }), 'utf8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-cmd-component-'));
  fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
  __setWorkspaceFolder(tmpDir);
  __setConfig({
    'codediary.storagePath': '.vscode/codediary.yaml',
    'codediary.defaultScope': 'shared',
  });
  context = { subscriptions: [] as any[] };
});

afterEach(() => {
  __clearWorkspace();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('codediary.editComponent', () => {
  it('updates name, description, and owners on a picked component', async () => {
    seedComponent({ id: 'billing', name: 'Billing', description: 'old', owners: ['alice'] });
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    __queueQuickPick({ id: 'billing' });
    __queueInputBox('Billing Engine', 'New description', 'alice, bob');

    await vscode.commands.executeCommand('codediary.editComponent');

    const updated = store.getComponent('billing')!;
    expect(updated.name).toBe('Billing Engine');
    expect(updated.description).toBe('New description');
    expect(updated.owners).toEqual(['alice', 'bob']);
    store.dispose();
  });

  it('clears description and owners when the user submits empty strings', async () => {
    seedComponent({ id: 'billing', name: 'Billing', description: 'to clear', owners: ['alice'] });
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    __queueQuickPick({ id: 'billing' });
    __queueInputBox('Billing', '', '');

    await vscode.commands.executeCommand('codediary.editComponent');

    const updated = store.getComponent('billing')!;
    expect(updated.description).toBeUndefined();
    expect(updated.owners).toBeUndefined();
    store.dispose();
  });

  it('skips the picker when a component node is passed in', async () => {
    seedComponent({ id: 'billing', name: 'Billing' });
    seedComponent({ id: 'reporting', name: 'Reporting' });
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    const reporting = store.getComponent('reporting')!;
    __queueInputBox('Reporting v2', '', '');

    await vscode.commands.executeCommand('codediary.editComponent', { component: reporting });

    expect(store.getComponent('reporting')!.name).toBe('Reporting v2');
    expect(store.getComponent('billing')!.name).toBe('Billing');
    store.dispose();
  });

  it('does nothing when the user aborts the name prompt', async () => {
    seedComponent({ id: 'billing', name: 'Billing' });
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    __queueQuickPick({ id: 'billing' });
    // no input queued — showInputBox returns undefined (user dismissed)

    await vscode.commands.executeCommand('codediary.editComponent');

    expect(store.getComponent('billing')!.name).toBe('Billing');
    store.dispose();
  });
});

describe('codediary.jumpToComponent', () => {
  it('opens the only file in a single-file component directly', async () => {
    seedComponent({ id: 'billing', name: 'Billing', files: ['src/billing/calc.ts'] });
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    __queueQuickPick({ id: 'billing' });

    await vscode.commands.executeCommand('codediary.jumpToComponent');

    const opened = __getExecutedCommands().find(c => c.id === 'vscode.open');
    expect(opened).toBeDefined();
    expect(opened!.args[0].fsPath).toBe(path.join(tmpDir, 'src/billing/calc.ts'));
    store.dispose();
  });

  it('prompts for a file when the component has multiple files', async () => {
    seedComponent({
      id: 'billing',
      name: 'Billing',
      files: ['src/billing/calc.ts', 'src/billing/report.ts'],
    });
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    __queueQuickPick({ id: 'billing' }, { label: 'src/billing/report.ts' });

    await vscode.commands.executeCommand('codediary.jumpToComponent');

    const opened = __getExecutedCommands().find(c => c.id === 'vscode.open');
    expect(opened!.args[0].fsPath).toBe(path.join(tmpDir, 'src/billing/report.ts'));
    store.dispose();
  });

  it('does nothing for an empty component', async () => {
    seedComponent({ id: 'billing', name: 'Billing', files: [] });
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    __queueQuickPick({ id: 'billing' });

    await vscode.commands.executeCommand('codediary.jumpToComponent');

    expect(__getExecutedCommands().find(c => c.id === 'vscode.open')).toBeUndefined();
    store.dispose();
  });

  it('rejects an unsafe path (symlink-style traversal)', async () => {
    seedComponent({ id: 'sneaky', name: 'Sneaky', files: ['../etc/passwd'] });
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    __queueQuickPick({ id: 'sneaky' });

    await vscode.commands.executeCommand('codediary.jumpToComponent');

    expect(__getExecutedCommands().find(c => c.id === 'vscode.open')).toBeUndefined();
    store.dispose();
  });
});

describe('codediary.manageComponentsForFile', () => {
  function setActiveFile(rel: string): void {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (!fs.existsSync(full)) { fs.writeFileSync(full, '', 'utf8'); }
    __setActiveTextEditor({ document: { uri: Uri.file(full) } });
  }

  it('creates the first component when none exist and tags the file', async () => {
    setActiveFile('src/foo.ts');
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    __queueQuickPick({ id: '__create_new__' });
    __queueInputBox('Billing', 'does billing');

    await vscode.commands.executeCommand('codediary.manageComponentsForFile');

    const components = store.getComponents();
    expect(components).toHaveLength(1);
    expect(components[0].id).toBe('billing');
    expect(components[0].files).toEqual(['src/foo.ts']);
    store.dispose();
  });

  it('tags and untags based on the diff between current and picked memberships', async () => {
    seedComponent({ id: 'billing', name: 'Billing', files: ['src/foo.ts'] });
    seedComponent({ id: 'reporting', name: 'Reporting', files: [] });
    setActiveFile('src/foo.ts');
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    __queueQuickPick([
      { id: 'reporting' },
    ]);

    await vscode.commands.executeCommand('codediary.manageComponentsForFile');

    expect(store.getComponent('billing')!.files).toEqual([]);
    expect(store.getComponent('reporting')!.files).toEqual(['src/foo.ts']);
    store.dispose();
  });

  it('keeps a pre-selected component picked and adds a new one', async () => {
    seedComponent({ id: 'billing', name: 'Billing', files: ['src/foo.ts'] });
    seedComponent({ id: 'reporting', name: 'Reporting', files: [] });
    setActiveFile('src/foo.ts');
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    __queueQuickPick([
      { id: 'billing' },
      { id: 'reporting' },
    ]);

    await vscode.commands.executeCommand('codediary.manageComponentsForFile');

    expect(store.getComponent('billing')!.files).toEqual(['src/foo.ts']);
    expect(store.getComponent('reporting')!.files).toEqual(['src/foo.ts']);
    store.dispose();
  });

  it('creates a new component inline when the create-new item is picked alongside existing', async () => {
    seedComponent({ id: 'billing', name: 'Billing', files: [] });
    setActiveFile('src/foo.ts');
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    __queueQuickPick([
      { id: 'billing' },
      { id: '__create_new__' },
    ]);
    __queueInputBox('Reporting', '');

    await vscode.commands.executeCommand('codediary.manageComponentsForFile');

    expect(store.getComponent('billing')!.files).toEqual(['src/foo.ts']);
    const reporting = store.getComponent('reporting');
    expect(reporting).toBeDefined();
    expect(reporting!.files).toEqual(['src/foo.ts']);
    store.dispose();
  });

  it('does nothing when the multi-select is dismissed', async () => {
    seedComponent({ id: 'billing', name: 'Billing', files: [] });
    setActiveFile('src/foo.ts');
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    // no quick pick queued — returns undefined

    await vscode.commands.executeCommand('codediary.manageComponentsForFile');

    expect(store.getComponent('billing')!.files).toEqual([]);
    store.dispose();
  });

  it('returns silently when there is no active editor', async () => {
    const store = new DiaryStore();
    registerComponentCommands(context, store);

    await vscode.commands.executeCommand('codediary.manageComponentsForFile');

    expect(store.getComponents()).toEqual([]);
    store.dispose();
  });
});
