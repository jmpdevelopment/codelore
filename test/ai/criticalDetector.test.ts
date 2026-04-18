import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { CriticalDetector } from '../../src/ai/criticalDetector';
import { LoreStore } from '../../src/storage/loreStore';
import { LmService } from '../../src/ai/lmService';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelore-ai-'));
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

describe('CriticalDetector.parseRegions', () => {
  function getParser() {
    const store = new LoreStore();
    const lm = new LmService();
    const detector = new CriticalDetector(lm, store);
    const parseRegions = (detector as any).parseRegions.bind(detector);
    return { parseRegions, store, dispose: () => store.dispose() };
  }

  it('parses valid JSON array', () => {
    const { parseRegions, dispose } = getParser();
    const raw = JSON.stringify([
      { file: 'src/auth.ts', line_start: 10, line_end: 20, severity: 'critical', description: 'Token bypass' },
    ]);
    const result = parseRegions(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: 'src/auth.ts',
      line_start: 10,
      line_end: 20,
      severity: 'critical',
      description: 'Token bypass',
    });
    dispose();
  });

  it('strips markdown code fences', () => {
    const { parseRegions, dispose } = getParser();
    const raw = '```json\n[{"file":"a.ts","line_start":1,"line_end":5,"severity":"high","description":"risk"}]\n```';
    const result = parseRegions(raw);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('a.ts');
    dispose();
  });

  it('strips fences without json tag', () => {
    const { parseRegions, dispose } = getParser();
    const raw = '```\n[{"file":"a.ts","line_start":1,"line_end":5,"severity":"high","description":"risk"}]\n```';
    const result = parseRegions(raw);
    expect(result).toHaveLength(1);
    dispose();
  });

  it('filters entries missing required fields', () => {
    const { parseRegions, dispose } = getParser();
    const raw = JSON.stringify([
      { file: 'a.ts', line_start: 1, severity: 'high', description: 'ok' },
      { file: 'a.ts', severity: 'high', description: 'missing line_start' },
      { file: 'a.ts', line_start: 5, description: 'missing severity' },
      { file: 'a.ts', line_start: 5, severity: 'high' },
    ]);
    const result = parseRegions(raw);
    expect(result).toHaveLength(1);
    expect(result[0].line_start).toBe(1);
    dispose();
  });

  it('uses line_start as line_end when line_end is missing', () => {
    const { parseRegions, dispose } = getParser();
    const raw = JSON.stringify([
      { file: 'a.ts', line_start: 42, severity: 'medium', description: 'single line' },
    ]);
    const result = parseRegions(raw);
    expect(result[0].line_end).toBe(42);
    dispose();
  });

  it('injects defaultFile when file field is missing', () => {
    const { parseRegions, dispose } = getParser();
    const raw = JSON.stringify([
      { line_start: 10, line_end: 20, severity: 'critical', description: 'risky' },
    ]);
    const result = parseRegions(raw, 'src/target.ts');
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/target.ts');
    dispose();
  });

  it('uses "unknown" when no file and no defaultFile', () => {
    const { parseRegions, dispose } = getParser();
    const raw = JSON.stringify([
      { line_start: 10, line_end: 20, severity: 'critical', description: 'risky' },
    ]);
    const result = parseRegions(raw);
    expect(result[0].file).toBe('unknown');
    dispose();
  });

  it('returns empty array for invalid JSON', () => {
    const { parseRegions, dispose } = getParser();
    expect(parseRegions('not json at all')).toEqual([]);
    dispose();
  });

  it('returns empty array for non-array JSON', () => {
    const { parseRegions, dispose } = getParser();
    expect(parseRegions('{"key": "value"}')).toEqual([]);
    dispose();
  });

  it('returns empty array for empty array', () => {
    const { parseRegions, dispose } = getParser();
    expect(parseRegions('[]')).toEqual([]);
    dispose();
  });

  it('preserves file field when present even with defaultFile', () => {
    const { parseRegions, dispose } = getParser();
    const raw = JSON.stringify([
      { file: 'explicit.ts', line_start: 1, line_end: 5, severity: 'high', description: 'test' },
    ]);
    const result = parseRegions(raw, 'default.ts');
    expect(result[0].file).toBe('explicit.ts');
    dispose();
  });
});

describe('CriticalDetector.scanFiles batch mode', () => {
  it('iterates files, auto-flags every region with human_reviewed=false', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/a.ts'), 'export const A = 1;\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src/b.ts'), 'export const B = 2;\n', 'utf8');

    const store = new LoreStore();
    const lm = new LmService();
    const seenPaths: string[] = [];
    (lm as any).generate = async (_system: string, user: string) => {
      const match = user.match(/<file path="([^"]+)">/);
      const filePath = match ? match[1] : '';
      seenPaths.push(filePath);
      return {
        text: JSON.stringify([
          { line_start: 1, line_end: 1, severity: 'high', description: `risk in ${filePath}` },
        ]),
        modelName: 'stub/model',
      };
    };
    const detector = new CriticalDetector(lm, store);

    await detector.scanFiles(['src/a.ts', 'src/b.ts'], 'test scope');

    expect(seenPaths).toEqual(['src/a.ts', 'src/b.ts']);
    const a = store.getCriticalFlagsForFile('src/a.ts');
    const b = store.getCriticalFlagsForFile('src/b.ts');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].human_reviewed).toBe(false);
    expect(a[0].description).toContain('src/a.ts');
    store.dispose();
  });

  it('drops regions whose file does not match the source file', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/a.ts'), 'export const A = 1;\n', 'utf8');

    const store = new LoreStore();
    const lm = new LmService();
    (lm as any).generate = async () => ({
      text: JSON.stringify([
        { file: 'src/a.ts', line_start: 1, line_end: 1, severity: 'high', description: 'real' },
        { file: 'src/wandered.ts', line_start: 5, line_end: 5, severity: 'high', description: 'wrong' },
      ]),
      modelName: 'stub/model',
    });
    const detector = new CriticalDetector(lm, store);

    await detector.scanFiles(['src/a.ts'], 'test');

    const flags = store.getCriticalFlagsForFile('src/a.ts');
    expect(flags).toHaveLength(1);
    expect(flags[0].description).toBe('real');
    expect(store.getCriticalFlagsForFile('src/wandered.ts')).toHaveLength(0);
    store.dispose();
  });

  it('skips missing files silently', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/real.ts'), 'export {};\n', 'utf8');

    const store = new LoreStore();
    const lm = new LmService();
    let calls = 0;
    (lm as any).generate = async () => { calls++; return { text: '[]', modelName: 'stub' }; };
    const detector = new CriticalDetector(lm, store);

    await detector.scanFiles(['src/missing.ts', 'src/real.ts'], 'test');

    expect(calls).toBe(1);
    store.dispose();
  });
});
