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
  Uri,
} from '../__mocks__/vscode';
import { DiaryGenerator } from '../../src/ai/diaryGenerator';
import { DiaryStore } from '../../src/storage/diaryStore';
import { LmService } from '../../src/ai/lmService';
import { Annotation } from '../../src/models/annotation';
import { CriticalFlag } from '../../src/models/criticalFlag';

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
    const parseEntries = (raw: string, extractFile = false) =>
      (generator as any).parseEntries.call(generator, raw, extractFile);
    const numberLines = (generator as any).numberLines.bind(generator);
    return { parseEntries, numberLines, store, dispose: () => store.dispose() };
  }

  describe('parseEntries', () => {
    it('parses valid JSON array', () => {
      const { parseEntries, dispose } = getParser();
      const raw = JSON.stringify([
        { category: 'behavior', line_start: 10, line_end: 20, text: 'Looks correct' },
        { category: 'rationale', line_start: 30, line_end: 40, text: 'Check this' },
      ]);
      const result = parseEntries(raw);
      expect(result).toHaveLength(2);
      expect(result[0].category).toBe('behavior');
      expect(result[1].text).toBe('Check this');
      dispose();
    });

    it('strips markdown code fences', () => {
      const { parseEntries, dispose } = getParser();
      const raw = '```json\n[{"category":"rationale","line_start":1,"line_end":5,"text":"note"}]\n```';
      const result = parseEntries(raw);
      expect(result).toHaveLength(1);
      dispose();
    });

    it('filters entries missing required fields', () => {
      const { parseEntries, dispose } = getParser();
      const raw = JSON.stringify([
        { category: 'behavior', line_start: 10, text: 'ok' },
        { line_start: 20, text: 'no category' },
        { category: 'behavior', text: 'no line_start' },
        { category: 'behavior', line_start: 30 },
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

    it('rejects legacy categories — only knowledge-first categories accepted', () => {
      const { parseEntries, dispose } = getParser();
      const raw = JSON.stringify([
        { category: 'verified', line_start: 1, line_end: 5, text: 'legacy' },
        { category: 'needs_review', line_start: 6, line_end: 10, text: 'legacy' },
        { category: 'hallucination', line_start: 11, line_end: 15, text: 'legacy' },
        { category: 'behavior', line_start: 16, line_end: 20, text: 'knowledge-first' },
      ]);
      const result = parseEntries(raw);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('behavior');
      dispose();
    });
  });

  describe('parseEntries with extractFile', () => {
    it('extracts file field when extractFile is true', () => {
      const { parseEntries, dispose } = getParser();
      const raw = JSON.stringify([
        { category: 'behavior', line_start: 10, text: 'ok', file: 'src/foo.ts' },
      ]);
      const result = parseEntries(raw, true);
      expect(result).toHaveLength(1);
      expect(result[0].file).toBe('src/foo.ts');
      dispose();
    });

    it('does not extract file when extractFile is false', () => {
      const { parseEntries, dispose } = getParser();
      const raw = JSON.stringify([
        { category: 'behavior', line_start: 10, text: 'ok', file: 'src/foo.ts' },
      ]);
      const result = parseEntries(raw);
      expect(result).toHaveLength(1);
      expect(result[0].file).toBeUndefined();
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

  describe('parseDependencies security', () => {
    it('rejects absolute paths in dependencies', () => {
      const { parseEntries, dispose } = getParser();
      const raw = JSON.stringify([
        {
          category: 'behavior', line_start: 1, line_end: 5, text: 'note',
          dependencies: [{ file: '/etc/passwd', relationship: 'reads' }],
        },
      ]);
      const result = parseEntries(raw);
      expect(result).toHaveLength(1);
      expect(result[0].dependencies).toBeUndefined();
      dispose();
    });

    it('rejects path traversal in dependencies', () => {
      const { parseEntries, dispose } = getParser();
      const raw = JSON.stringify([
        {
          category: 'behavior', line_start: 1, line_end: 5, text: 'note',
          dependencies: [{ file: '../../../etc/passwd', relationship: 'reads' }],
        },
      ]);
      const result = parseEntries(raw);
      expect(result).toHaveLength(1);
      expect(result[0].dependencies).toBeUndefined();
      dispose();
    });

    it('accepts valid dependency paths', () => {
      const { parseEntries, dispose } = getParser();
      const raw = JSON.stringify([
        {
          category: 'behavior', line_start: 1, line_end: 5, text: 'note',
          dependencies: [{ file: 'src/billing/calc.py', relationship: 'must stay in sync' }],
        },
      ]);
      const result = parseEntries(raw);
      expect(result).toHaveLength(1);
      expect(result[0].dependencies).toHaveLength(1);
      expect(result[0].dependencies![0].file).toBe('src/billing/calc.py');
      dispose();
    });

    it('validates dependency line ranges', () => {
      const { parseEntries, dispose } = getParser();
      const raw = JSON.stringify([
        {
          category: 'behavior', line_start: 1, line_end: 5, text: 'note',
          dependencies: [{ file: 'src/foo.ts', relationship: 'related', line_start: -1, line_end: 10 }],
        },
      ]);
      const result = parseEntries(raw);
      expect(result).toHaveLength(1);
      // Invalid line range should be dropped
      expect(result[0].dependencies![0].line_start).toBeUndefined();
      dispose();
    });
  });

  describe('formatExistingKnowledge', () => {
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

    it('returns empty string when no existing knowledge', () => {
      const store = new DiaryStore();
      const lm = new LmService();
      const generator = new DiaryGenerator(lm, store);
      const result = generator.formatExistingKnowledge('src/foo.ts');
      expect(result).toBe('');
      store.dispose();
    });

    it('includes annotations for the file', () => {
      const store = new DiaryStore();
      const lm = new LmService();
      const generator = new DiaryGenerator(lm, store);
      store.addAnnotation(makeAnnotation({ text: 'billing off-by-one is intentional' }));

      const result = generator.formatExistingKnowledge('src/foo.ts');
      expect(result).toContain('existing_knowledge');
      expect(result).toContain('billing off-by-one is intentional');
      expect(result).toContain('Behavior');
      expect(result).toContain('L10-20');
      store.dispose();
    });

    it('includes critical flags for the file', () => {
      const store = new DiaryStore();
      const lm = new LmService();
      const generator = new DiaryGenerator(lm, store);
      store.addCriticalFlag(makeFlag({ description: 'Token validation logic' }));

      const result = generator.formatExistingKnowledge('src/foo.ts');
      expect(result).toContain('Token validation logic');
      expect(result).toContain('critical');
      expect(result).toContain('unreviewed');
      store.dispose();
    });

    it('shows reviewed status for resolved critical flags', () => {
      const store = new DiaryStore();
      const lm = new LmService();
      const generator = new DiaryGenerator(lm, store);
      store.addCriticalFlag(makeFlag({ human_reviewed: true }));

      const result = generator.formatExistingKnowledge('src/foo.ts');
      expect(result).toContain('reviewed');
      expect(result).not.toContain('unreviewed');
      store.dispose();
    });

    it('does not include annotations for other files', () => {
      const store = new DiaryStore();
      const lm = new LmService();
      const generator = new DiaryGenerator(lm, store);
      store.addAnnotation(makeAnnotation({ file: 'src/other.ts', text: 'wrong file' }));

      const result = generator.formatExistingKnowledge('src/foo.ts');
      expect(result).toBe('');
      store.dispose();
    });

    it('includes both annotations and critical flags', () => {
      const store = new DiaryStore();
      const lm = new LmService();
      const generator = new DiaryGenerator(lm, store);
      store.addAnnotation(makeAnnotation({ text: 'verified the auth flow' }));
      store.addCriticalFlag(makeFlag({ description: 'Payment logic' }));

      const result = generator.formatExistingKnowledge('src/foo.ts');
      expect(result).toContain('verified the auth flow');
      expect(result).toContain('Payment logic');
      expect(result).toContain('Existing annotations');
      expect(result).toContain('Existing critical flags');
      store.dispose();
    });
  });

  describe('component awareness', () => {
    function writeComponent(dir: string, id: string, payload: Record<string, unknown>): void {
      const yaml = require('js-yaml');
      const file = path.join(dir, '.codediary', 'components', `${id}.yaml`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, yaml.dump({ version: 2, ...payload }), 'utf8');
    }

    it('formatComponentContext lists only the components the file is tagged into', () => {
      writeComponent(tmpDir, 'billing', {
        id: 'billing', name: 'Billing', description: 'invoice + tax',
        files: ['src/foo.ts', 'src/billing/calc.ts'],
        source: 'human_authored',
        created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
      });
      writeComponent(tmpDir, 'reporting', {
        id: 'reporting', name: 'Reporting',
        files: ['src/reporting/monthly.ts'],
        source: 'human_authored',
        created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
      });
      const store = new DiaryStore();
      const generator = new DiaryGenerator(new LmService(), store);

      const block = generator.formatComponentContext('src/foo.ts');
      expect(block).toContain('<components>');
      expect(block).toContain('billing (Billing)');
      expect(block).toContain('invoice + tax');
      expect(block).toContain('src/billing/calc.ts');
      expect(block).not.toContain('reporting');
      store.dispose();
    });

    it('formatComponentContext is empty when the file is untagged', () => {
      writeComponent(tmpDir, 'billing', {
        id: 'billing', name: 'Billing', files: ['src/other.ts'],
        source: 'human_authored',
        created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
      });
      const store = new DiaryStore();
      const generator = new DiaryGenerator(new LmService(), store);
      expect(generator.formatComponentContext('src/foo.ts')).toBe('');
      store.dispose();
    });

    it('formatAllComponentsContext enumerates every component id', () => {
      writeComponent(tmpDir, 'billing', {
        id: 'billing', name: 'Billing', description: 'invoice',
        files: [],
        source: 'human_authored',
        created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
      });
      writeComponent(tmpDir, 'reporting', {
        id: 'reporting', name: 'Reporting', files: [],
        source: 'human_authored',
        created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
      });
      const store = new DiaryStore();
      const generator = new DiaryGenerator(new LmService(), store);
      const block = generator.formatAllComponentsContext();
      expect(block).toContain('billing (Billing)');
      expect(block).toContain('invoice');
      expect(block).toContain('reporting (Reporting)');
      store.dispose();
    });

    it('scanForKnowledge sends a full-file prompt (no diff) and persists accepted entries', async () => {
      writeComponent(tmpDir, 'billing', {
        id: 'billing', name: 'Billing',
        files: ['src/foo.ts'],
        source: 'human_authored',
        created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
      });

      const filePath = path.join(tmpDir, 'src/foo.ts');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, 'function charge() {\n  return 42;\n}\n', 'utf8');

      const store = new DiaryStore();
      const lm = new LmService();
      let capturedPrompt = '';
      (lm as any).generate = async (_system: string, user: string) => {
        capturedPrompt = user;
        return {
          text: JSON.stringify([
            { category: 'behavior', line_start: 1, line_end: 3, text: 'charge returns a fixed amount', components: ['billing'] },
          ]),
          modelName: 'stub/model',
        };
      };
      const generator = new DiaryGenerator(lm, store);

      const editor = {
        document: {
          uri: Uri.file(filePath),
          getText: () => 'function charge() {\n  return 42;\n}\n',
        },
      };
      __setActiveTextEditor(editor);

      // presentSuggestions calls showQuickPick with the items; our mock returns
      // a canned array representing the user's selection.
      __queueQuickPick([
        {
          entry: { category: 'behavior', line_start: 1, line_end: 3, text: 'charge returns a fixed amount', components: ['billing'] },
          overlapping: [],
        },
      ]);

      await generator.scanForKnowledge(editor as any);

      expect(capturedPrompt).toContain('<scope>full-file knowledge scan');
      expect(capturedPrompt).not.toContain('<diff>');
      expect(capturedPrompt).toContain('1: function charge()');
      expect(capturedPrompt).toContain('<components>');

      const stored = store.getAnnotationsForFile('src/foo.ts');
      expect(stored).toHaveLength(1);
      expect(stored[0].source).toBe('ai_generated');
      expect(stored[0].components).toEqual(['billing']);
      store.dispose();
    });

    it('parseEntries keeps valid component ids and drops unknown ones', () => {
      writeComponent(tmpDir, 'billing', {
        id: 'billing', name: 'Billing', files: [],
        source: 'human_authored',
        created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
      });
      const store = new DiaryStore();
      const generator = new DiaryGenerator(new LmService(), store);
      const raw = JSON.stringify([
        {
          category: 'behavior', line_start: 1, line_end: 5, text: 'ok',
          components: ['billing', 'does-not-exist', 'billing'],
        },
        {
          category: 'rationale', line_start: 6, line_end: 10, text: 'untagged',
          components: [],
        },
      ]);
      const result = (generator as any).parseEntries(raw);
      expect(result[0].components).toEqual(['billing']);
      expect(result[1].components).toBeUndefined();
      store.dispose();
    });
  });
});
