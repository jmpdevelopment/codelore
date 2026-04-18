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
  __resetPrompts,
  commands,
} from '../__mocks__/vscode';
import { registerFilterCommand } from '../../src/commands/filter';
import { LoreStore } from '../../src/storage/loreStore';
import { ChangePlanProvider } from '../../src/views/changePlanProvider';
import { CriticalQueueProvider } from '../../src/views/criticalQueueProvider';
import { Annotation } from '../../src/models/annotation';
import { CriticalFlag } from '../../src/models/criticalFlag';

let tmpDir: string;

function makeContext() {
  const subscriptions: { dispose: () => void }[] = [];
  return { subscriptions } as any;
}

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    file: 'src/foo.ts',
    line_start: 1,
    line_end: 5,
    category: 'behavior',
    text: 'note',
    source: 'human_authored',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeFlag(overrides: Partial<CriticalFlag> = {}): CriticalFlag {
  return {
    file: 'src/foo.ts',
    line_start: 1,
    line_end: 5,
    severity: 'critical',
    human_reviewed: false,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelore-filter-'));
  fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
  __setWorkspaceFolder(tmpDir);
  __setConfig({
    'codelore.storagePath': '.vscode/codelore.yaml',
    'codelore.defaultScope': 'shared',
  });
  __resetPrompts();
});

afterEach(() => {
  __clearWorkspace();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('codelore.filter', () => {
  function setup() {
    const store = new LoreStore();
    const changePlan = new ChangePlanProvider(store);
    const criticalQueue = new CriticalQueueProvider(store);
    const ctx = makeContext();
    registerFilterCommand(ctx, store, changePlan, criticalQueue);
    return { store, changePlan, criticalQueue, dispose: () => store.dispose() };
  }

  it('returns silently when the dimension picker is dismissed', async () => {
    const { changePlan, dispose } = setup();
    __queueQuickPick(undefined);
    await commands.executeCommand('codelore.filter');
    expect(changePlan.getActiveFilters().category).toBeUndefined();
    dispose();
  });

  it('category dimension applies the chosen category to the change plan', async () => {
    const { changePlan, dispose } = setup();
    __queueQuickPick(
      { action: 'category' },
      { category: 'gotcha' },
    );
    await commands.executeCommand('codelore.filter');
    expect(changePlan.getActiveFilters().category).toBe('gotcha');
    dispose();
  });

  it('severity dimension applies the chosen severity to the critical queue', async () => {
    const { criticalQueue, dispose } = setup();
    __queueQuickPick(
      { action: 'severity' },
      { severity: 'high' },
    );
    await commands.executeCommand('codelore.filter');
    expect(criticalQueue.getActiveFilters().severity).toBe('high');
    dispose();
  });

  it('component dimension warns and exits when no components exist', async () => {
    const { changePlan, dispose } = setup();
    __queueQuickPick({ action: 'component' });
    await commands.executeCommand('codelore.filter');
    expect(changePlan.getActiveFilters().component).toBeUndefined();
    dispose();
  });

  it('component dimension applies a chosen component when at least one exists', async () => {
    const { store, changePlan, dispose } = setup();
    store.components.upsert({
      id: 'billing',
      name: 'Billing',
      files: ['src/foo.ts'],
      source: 'human_authored',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    __queueQuickPick(
      { action: 'component' },
      { id: 'billing' },
    );
    await commands.executeCommand('codelore.filter');
    expect(changePlan.getActiveFilters().component).toBe('billing');
    dispose();
  });

  it('path dimension applies the input value to both providers', async () => {
    const { changePlan, criticalQueue, dispose } = setup();
    __queueQuickPick({ action: 'path' });
    __queueInputBox('src/auth');
    await commands.executeCommand('codelore.filter');
    expect(changePlan.getActiveFilters().path).toBe('src/auth');
    expect(criticalQueue.getActiveFilters().path).toBe('src/auth');
    dispose();
  });

  it('path dimension clears when input is empty', async () => {
    const { store, changePlan, criticalQueue, dispose } = setup();
    store.addAnnotation(makeAnnotation());
    changePlan.setPathFilter('src/auth');
    criticalQueue.setPathFilter('src/auth');

    __queueQuickPick({ action: 'path' });
    __queueInputBox('   ');
    await commands.executeCommand('codelore.filter');

    expect(changePlan.getActiveFilters().path).toBeUndefined();
    expect(criticalQueue.getActiveFilters().path).toBeUndefined();
    dispose();
  });

  it('clear action wipes all five filter slots', async () => {
    const { store, changePlan, criticalQueue, dispose } = setup();
    store.addAnnotation(makeAnnotation());
    store.addCriticalFlag(makeFlag());
    store.components.upsert({
      id: 'billing', name: 'Billing', files: ['src/foo.ts'],
      source: 'human_authored',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    changePlan.setFilter('behavior');
    changePlan.setPathFilter('src');
    changePlan.setComponentFilter('billing');
    criticalQueue.setPathFilter('src');
    criticalQueue.setSeverityFilter('critical');

    __queueQuickPick({ action: 'clear' });
    await commands.executeCommand('codelore.filter');

    expect(changePlan.getActiveFilters()).toEqual({
      category: undefined, path: undefined, component: undefined,
    });
    expect(criticalQueue.getActiveFilters()).toEqual({
      path: undefined, severity: undefined,
    });
    dispose();
  });
});
