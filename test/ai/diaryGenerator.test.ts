import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { DiaryGenerator } from '../../src/ai/diaryGenerator';
import { DiaryStore } from '../../src/storage/diaryStore';
import { LmService } from '../../src/ai/lmService';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-gen-'));
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

describe('DiaryGenerator parsing', () => {
  function getParser() {
    const store = new DiaryStore();
    const lm = new LmService();
    const generator = new DiaryGenerator(lm, store);
    const parseEntries = (generator as any).parseEntries.bind(generator);
    const parseEntriesWithFile = (generator as any).parseEntriesWithFile.bind(generator);
    const numberLines = (generator as any).numberLines.bind(generator);
    return { parseEntries, parseEntriesWithFile, numberLines, store, dispose: () => store.dispose() };
  }

  describe('parseEntries', () => {
    it('parses valid JSON array', () => {
      const { parseEntries, dispose } = getParser();
      const raw = JSON.stringify([
        { category: 'verified', line_start: 10, line_end: 20, text: 'Looks correct' },
        { category: 'needs_review', line_start: 30, line_end: 40, text: 'Check this' },
      ]);
      const result = parseEntries(raw);
      expect(result).toHaveLength(2);
      expect(result[0].category).toBe('verified');
      expect(result[1].text).toBe('Check this');
      dispose();
    });

    it('strips markdown code fences', () => {
      const { parseEntries, dispose } = getParser();
      const raw = '```json\n[{"category":"intent","line_start":1,"line_end":5,"text":"note"}]\n```';
      const result = parseEntries(raw);
      expect(result).toHaveLength(1);
      dispose();
    });

    it('filters entries missing required fields', () => {
      const { parseEntries, dispose } = getParser();
      const raw = JSON.stringify([
        { category: 'verified', line_start: 10, text: 'ok' },
        { line_start: 20, text: 'no category' },
        { category: 'verified', text: 'no line_start' },
        { category: 'verified', line_start: 30 },
      ]);
      const result = parseEntries(raw);
      expect(result).toHaveLength(1);
      expect(result[0].line_start).toBe(10);
      dispose();
    });

    it('returns empty array for invalid JSON', () => {
      const { parseEntries, dispose } = getParser();
      expect(parseEntries('not json')).toEqual([]);
      dispose();
    });

    it('returns empty array for non-array JSON', () => {
      const { parseEntries, dispose } = getParser();
      expect(parseEntries('{"key": "value"}')).toEqual([]);
      dispose();
    });

    it('returns empty array for empty array', () => {
      const { parseEntries, dispose } = getParser();
      expect(parseEntries('[]')).toEqual([]);
      dispose();
    });
  });

  describe('parseEntriesWithFile', () => {
    it('delegates to parseEntries', () => {
      const { parseEntriesWithFile, dispose } = getParser();
      const raw = JSON.stringify([
        { category: 'verified', line_start: 10, text: 'ok', file: 'src/foo.ts' },
      ]);
      const result = parseEntriesWithFile(raw);
      expect(result).toHaveLength(1);
      dispose();
    });
  });

  describe('numberLines', () => {
    it('numbers lines starting at 1', () => {
      const { numberLines, dispose } = getParser();
      const result = numberLines('foo\nbar\nbaz');
      expect(result).toBe('1: foo\n2: bar\n3: baz');
      dispose();
    });

    it('handles single line', () => {
      const { numberLines, dispose } = getParser();
      expect(numberLines('hello')).toBe('1: hello');
      dispose();
    });

    it('handles empty string', () => {
      const { numberLines, dispose } = getParser();
      expect(numberLines('')).toBe('1: ');
      dispose();
    });
  });
});
