import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  __setWorkspaceFolder,
  __clearWorkspace,
  __setConfig,
  __setActiveTextEditor,
  __queueQuickPick,
} from '../__mocks__/vscode';
import * as vscode from '../__mocks__/vscode';
import { LoreStore } from '../../src/storage/loreStore';
import { registerAnnotateCommands } from '../../src/commands/annotate';
import { Annotation } from '../../src/models/annotation';

let tmpDir: string;
let context: any;

function seed(store: LoreStore, override: Partial<Annotation> & { id: string }): Annotation {
  const ann: Annotation = {
    id: override.id,
    file: override.file ?? 'src/foo.ts',
    line_start: override.line_start ?? 10,
    line_end: override.line_end ?? 12,
    category: override.category ?? 'behavior',
    text: override.text ?? 'AI-authored note',
    source: override.source ?? 'ai_generated',
    created_at: override.created_at ?? '2026-04-18T00:00:00Z',
    author: override.author,
    verified_by: override.verified_by,
    verified_at: override.verified_at,
  };
  store.addAnnotation(ann, 'shared');
  return ann;
}

function fakeEditor(filePath: string, line: number): any {
  return {
    document: {
      uri: vscode.Uri.file(path.join(tmpDir, filePath)),
      getText: () => '',
    },
    selection: { active: { line: line - 1 } },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelore-verify-'));
  fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
  __setWorkspaceFolder(tmpDir);
  __setConfig({
    'codelore.storagePath': '.vscode/codelore.yaml',
    'codelore.defaultScope': 'shared',
  });
  context = { subscriptions: [] as any[] };
});

afterEach(() => {
  __clearWorkspace();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('codelore.verifyAnnotation', () => {
  it('flips an ai_generated annotation to ai_verified and stamps verified_by/at', async () => {
    const store = new LoreStore();
    seed(store, { id: 'a-1' });
    registerAnnotateCommands(context, store);

    await vscode.commands.executeCommand(
      'codelore.verifyAnnotation',
      { annotation: { id: 'a-1' } },
    );

    const updated = store.getAnnotations().find(a => a.id === 'a-1')!;
    expect(updated.source).toBe('ai_verified');
    expect(updated.verified_by).toBeTruthy();
    expect(updated.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    store.dispose();
  });

  it('falls back to the cursor when no arg is given', async () => {
    const store = new LoreStore();
    seed(store, { id: 'a-2', file: 'src/bar.ts', line_start: 5, line_end: 8 });
    registerAnnotateCommands(context, store);

    __setActiveTextEditor(fakeEditor('src/bar.ts', 6));

    await vscode.commands.executeCommand('codelore.verifyAnnotation');

    expect(store.getAnnotations().find(a => a.id === 'a-2')!.source).toBe('ai_verified');
    store.dispose();
  });

  it('prompts when multiple ai_generated annotations overlap the cursor', async () => {
    const store = new LoreStore();
    seed(store, { id: 'a-3', file: 'src/baz.ts', line_start: 1, line_end: 20, text: 'first' });
    seed(store, { id: 'a-4', file: 'src/baz.ts', line_start: 5, line_end: 15, text: 'second' });
    registerAnnotateCommands(context, store);

    __setActiveTextEditor(fakeEditor('src/baz.ts', 10));
    __queueQuickPick({ id: 'a-4' });

    await vscode.commands.executeCommand('codelore.verifyAnnotation');

    expect(store.getAnnotations().find(a => a.id === 'a-3')!.source).toBe('ai_generated');
    expect(store.getAnnotations().find(a => a.id === 'a-4')!.source).toBe('ai_verified');
    store.dispose();
  });

  it('does nothing for already-verified annotations', async () => {
    const store = new LoreStore();
    seed(store, {
      id: 'a-5',
      source: 'ai_verified',
      verified_by: 'alice',
      verified_at: '2026-04-01T00:00:00Z',
    });
    registerAnnotateCommands(context, store);

    await vscode.commands.executeCommand(
      'codelore.verifyAnnotation',
      { annotation: { id: 'a-5' } },
    );

    const after = store.getAnnotations().find(a => a.id === 'a-5')!;
    expect(after.verified_by).toBe('alice');
    expect(after.verified_at).toBe('2026-04-01T00:00:00Z');
    store.dispose();
  });

  it('does nothing for human_authored annotations', async () => {
    const store = new LoreStore();
    seed(store, { id: 'a-6', source: 'human_authored' });
    registerAnnotateCommands(context, store);

    await vscode.commands.executeCommand(
      'codelore.verifyAnnotation',
      { annotation: { id: 'a-6' } },
    );

    const after = store.getAnnotations().find(a => a.id === 'a-6')!;
    expect(after.source).toBe('human_authored');
    expect(after.verified_by).toBeUndefined();
    expect(after.verified_at).toBeUndefined();
    store.dispose();
  });

  it('ignores already-verified annotations when picking from the cursor', async () => {
    const store = new LoreStore();
    seed(store, { id: 'a-7', file: 'src/qux.ts', line_start: 1, line_end: 10, source: 'ai_verified' });
    seed(store, { id: 'a-8', file: 'src/qux.ts', line_start: 1, line_end: 10, source: 'ai_generated' });
    registerAnnotateCommands(context, store);

    __setActiveTextEditor(fakeEditor('src/qux.ts', 5));

    await vscode.commands.executeCommand('codelore.verifyAnnotation');

    expect(store.getAnnotations().find(a => a.id === 'a-7')!.source).toBe('ai_verified');
    expect(store.getAnnotations().find(a => a.id === 'a-8')!.source).toBe('ai_verified');
    store.dispose();
  });
});
