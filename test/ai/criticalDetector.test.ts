import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { CriticalDetector } from '../../src/ai/criticalDetector';
import { DiaryStore } from '../../src/storage/diaryStore';
import { LmService } from '../../src/ai/lmService';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-ai-'));
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

describe('CriticalDetector.parseRegions', () => {
  function getParser() {
    const store = new DiaryStore();
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
