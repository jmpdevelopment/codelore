import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import {
  __setWorkspaceFolder,
  __clearWorkspace,
  __setConfig,
  __queueQuickPick,
  __setFindFilesResult,
} from '../__mocks__/vscode';
import { ComponentProposer } from '../../src/ai/componentProposer';
import { LoreStore } from '../../src/storage/loreStore';
import { LmService } from '../../src/ai/lmService';

let tmpDir: string;

function initRepo(): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
}

function writeTracked(rel: string, content: string): void {
  const file = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  execFileSync('git', ['add', rel], { cwd: tmpDir });
}

function writeUntracked(rel: string, content: string): void {
  const file = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelore-propose-'));
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

describe('ComponentProposer.parseProposals', () => {
  function makeProposer(): ComponentProposer {
    const store = new LoreStore();
    return new ComponentProposer(new LmService(), store);
  }

  it('keeps valid proposals and drops unknown files', () => {
    const p = makeProposer();
    const valid = new Set(['src/billing/calc.ts', 'src/billing/invoice.ts']);
    const raw = JSON.stringify([
      {
        id: 'billing', name: 'Billing', description: 'charges & invoices',
        files: ['src/billing/calc.ts', 'src/billing/invoice.ts', 'src/unknown.ts'],
      },
    ]);
    const result = p.parseProposals(raw, valid, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].files).toEqual(['src/billing/calc.ts', 'src/billing/invoice.ts']);
  });

  it('drops proposals whose files all fall outside the candidate set', () => {
    const p = makeProposer();
    const raw = JSON.stringify([
      { id: 'phantom', name: 'Phantom', files: ['nope.ts'] },
    ]);
    expect(p.parseProposals(raw, new Set(['real.ts']), new Set())).toEqual([]);
  });

  it('derives an id from the name when id is missing or invalid', () => {
    const p = makeProposer();
    const raw = JSON.stringify([
      { name: 'Billing Engine', files: ['src/foo.ts'] },
      { id: 'INVALID ID', name: 'Reporting', files: ['src/bar.ts'] },
    ]);
    const result = p.parseProposals(raw, new Set(['src/foo.ts', 'src/bar.ts']), new Set());
    expect(result.map(r => r.id)).toEqual(['billing-engine', 'reporting']);
  });

  it('skips proposals that collide with existing component ids', () => {
    const p = makeProposer();
    const raw = JSON.stringify([
      { id: 'billing', name: 'Billing', files: ['src/foo.ts'] },
      { id: 'reporting', name: 'Reporting', files: ['src/bar.ts'] },
    ]);
    const result = p.parseProposals(raw, new Set(['src/foo.ts', 'src/bar.ts']), new Set(['billing']));
    expect(result.map(r => r.id)).toEqual(['reporting']);
  });

  it('deduplicates files within a single proposal', () => {
    const p = makeProposer();
    const raw = JSON.stringify([
      { id: 'billing', name: 'Billing', files: ['src/foo.ts', 'src/foo.ts'] },
    ]);
    const result = p.parseProposals(raw, new Set(['src/foo.ts']), new Set());
    expect(result[0].files).toEqual(['src/foo.ts']);
  });

  it('returns an empty array for non-JSON input', () => {
    const p = makeProposer();
    expect(p.parseProposals('not json', new Set(), new Set())).toEqual([]);
  });
});

describe('ComponentProposer.gatherCandidateFiles', () => {
  it('returns uncommitted changes when the repo has any', async () => {
    initRepo();
    writeTracked('src/seed.ts', 'export {};\n');
    execFileSync('git', ['commit', '-qm', 'seed'], { cwd: tmpDir });

    writeTracked('src/new.ts', 'export const x = 1;\n');
    writeUntracked('src/another.ts', 'export const y = 2;\n');

    const store = new LoreStore();
    const proposer = new ComponentProposer(new LmService(), store);
    const files = await proposer.gatherCandidateFiles();
    expect(files).toContain('src/new.ts');
    store.dispose();
  });

  it('falls back to files referenced by annotations when no changes exist', async () => {
    initRepo();
    writeTracked('src/a.ts', 'export {};\n');
    execFileSync('git', ['commit', '-qm', 'clean'], { cwd: tmpDir });

    const store = new LoreStore();
    store.addAnnotation({
      id: 'ann-1', file: 'src/a.ts', line_start: 1, line_end: 1,
      category: 'behavior', text: 'note', source: 'human_authored',
      created_at: '2026-04-18T00:00:00Z',
    });
    const proposer = new ComponentProposer(new LmService(), store);
    expect(await proposer.gatherCandidateFiles()).toEqual(['src/a.ts']);
    store.dispose();
  });

  it('falls back to workspace source files on a clean first-run repo', async () => {
    initRepo();
    writeTracked('src/billing/calc.ts', 'export {};\n');
    writeTracked('src/billing/invoice.ts', 'export {};\n');
    writeTracked('src/reporting/monthly.ts', 'export {};\n');
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: tmpDir });

    // Simulate what vscode.workspace.findFiles would return. The mock returns
    // these paths regardless of the include/exclude pattern.
    __setFindFilesResult([
      path.join(tmpDir, 'src/billing/calc.ts'),
      path.join(tmpDir, 'src/billing/invoice.ts'),
      path.join(tmpDir, 'src/reporting/monthly.ts'),
    ]);

    const store = new LoreStore();
    const proposer = new ComponentProposer(new LmService(), store);
    const files = await proposer.gatherCandidateFiles();
    expect(files).toEqual([
      'src/billing/calc.ts',
      'src/billing/invoice.ts',
      'src/reporting/monthly.ts',
    ]);
    store.dispose();
  });
});

describe('ComponentProposer.propose end-to-end', () => {
  it('persists accepted proposals via the store', async () => {
    initRepo();
    writeTracked('src/billing/calc.ts', 'export {};\n');
    writeTracked('src/billing/invoice.ts', 'export {};\n');
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: tmpDir });
    writeUntracked('src/billing/refund.ts', 'export {};\n');
    writeUntracked('src/reporting/monthly.ts', 'export {};\n');
    writeUntracked('src/billing/calc.ts', 'export const x = 1;\n');

    const store = new LoreStore();
    const lm = new LmService();
    (lm as any).generate = async (_s: string, _u: string) => ({
      text: JSON.stringify([
        {
          id: 'billing', name: 'Billing', description: 'charges',
          files: ['src/billing/calc.ts', 'src/billing/refund.ts'],
        },
        {
          id: 'reporting', name: 'Reporting',
          files: ['src/reporting/monthly.ts'],
        },
      ]),
      modelName: 'stub/model',
    });
    const proposer = new ComponentProposer(lm, store);

    const pickedItems = [
      { proposal: { id: 'billing', name: 'Billing', description: 'charges', files: ['src/billing/calc.ts', 'src/billing/refund.ts'] } },
      { proposal: { id: 'reporting', name: 'Reporting', description: undefined, files: ['src/reporting/monthly.ts'] } },
    ];
    __queueQuickPick(pickedItems);

    await proposer.propose();

    expect(store.getComponent('billing')?.files.sort()).toEqual(
      ['src/billing/calc.ts', 'src/billing/refund.ts'],
    );
    expect(store.getComponent('reporting')?.source).toBe('ai_generated');
    store.dispose();
  });
});
