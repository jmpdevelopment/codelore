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
import { LoreGenerator } from '../../src/ai/loreGenerator';
import { LoreStore } from '../../src/storage/loreStore';
import { LmService } from '../../src/ai/lmService';
import { Annotation } from '../../src/models/annotation';
import { CriticalFlag } from '../../src/models/criticalFlag';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelore-gen-'));
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

describe('LoreGenerator parsing', () => {
  function getParser() {
    const store = new LoreStore();
    const lm = new LmService();
    const generator = new LoreGenerator(lm, store);
    const numberLines = (generator as any).numberLines.bind(generator);
    return {
      parseScanOutput: (raw: string) => generator.parseScanOutput(raw),
      numberLines,
      store,
      dispose: () => store.dispose(),
    };
  }

  describe('parseScanOutput', () => {
    it('parses a combined object with both annotations and critical_flags', () => {
      const { parseScanOutput, dispose } = getParser();
      const raw = JSON.stringify({
        annotations: [
          { category: 'behavior', line_start: 10, line_end: 20, text: 'Looks correct' },
          { category: 'rationale', line_start: 30, line_end: 40, text: 'Check this' },
        ],
        critical_flags: [
          { line_start: 5, line_end: 9, severity: 'critical', description: 'Token bypass' },
        ],
      });
      const result = parseScanOutput(raw);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].category).toBe('behavior');
      expect(result.flags).toHaveLength(1);
      expect(result.flags[0].severity).toBe('critical');
      dispose();
    });

    it('accepts missing fields as empty lists', () => {
      const { parseScanOutput, dispose } = getParser();
      expect(parseScanOutput('{}')).toEqual({ entries: [], flags: [] });
      expect(parseScanOutput(JSON.stringify({ annotations: [] }))).toEqual({ entries: [], flags: [] });
      dispose();
    });

    it('strips markdown code fences', () => {
      const { parseScanOutput, dispose } = getParser();
      const raw = '```json\n{"annotations":[{"category":"rationale","line_start":1,"line_end":5,"text":"note"}],"critical_flags":[]}\n```';
      const result = parseScanOutput(raw);
      expect(result.entries).toHaveLength(1);
      dispose();
    });

    it('filters entries missing required fields', () => {
      const { parseScanOutput, dispose } = getParser();
      const raw = JSON.stringify({
        annotations: [
          { category: 'behavior', line_start: 10, text: 'ok' },
          { line_start: 20, text: 'no category' },
          { category: 'behavior', text: 'no line_start' },
          { category: 'behavior', line_start: 30 },
        ],
        critical_flags: [],
      });
      const result = parseScanOutput(raw);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].line_start).toBe(10);
      dispose();
    });

    it('filters flags missing required fields', () => {
      const { parseScanOutput, dispose } = getParser();
      const raw = JSON.stringify({
        annotations: [],
        critical_flags: [
          { line_start: 1, severity: 'high', description: 'ok' },
          { severity: 'high', description: 'missing line_start' },
          { line_start: 5, description: 'missing severity' },
          { line_start: 5, severity: 'high' },
        ],
      });
      const result = parseScanOutput(raw);
      expect(result.flags).toHaveLength(1);
      expect(result.flags[0].line_start).toBe(1);
      dispose();
    });

    it('uses line_start as line_end when line_end is missing on flags', () => {
      const { parseScanOutput, dispose } = getParser();
      const raw = JSON.stringify({
        annotations: [],
        critical_flags: [
          { line_start: 42, severity: 'medium', description: 'single line' },
        ],
      });
      const result = parseScanOutput(raw);
      expect(result.flags[0].line_end).toBe(42);
      dispose();
    });

    it('returns empty lists for invalid JSON', () => {
      const { parseScanOutput, dispose } = getParser();
      expect(parseScanOutput('not json')).toEqual({ entries: [], flags: [] });
      dispose();
    });

    it('returns empty lists when the top level is an array (legacy format)', () => {
      const { parseScanOutput, dispose } = getParser();
      expect(parseScanOutput('[]')).toEqual({ entries: [], flags: [] });
      dispose();
    });

    it('rejects legacy categories — only knowledge-first categories accepted', () => {
      const { parseScanOutput, dispose } = getParser();
      const raw = JSON.stringify({
        annotations: [
          { category: 'verified', line_start: 1, line_end: 5, text: 'legacy' },
          { category: 'needs_review', line_start: 6, line_end: 10, text: 'legacy' },
          { category: 'hallucination', line_start: 11, line_end: 15, text: 'legacy' },
          { category: 'behavior', line_start: 16, line_end: 20, text: 'knowledge-first' },
        ],
        critical_flags: [],
      });
      const result = parseScanOutput(raw);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].category).toBe('behavior');
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
      const { parseScanOutput, dispose } = getParser();
      const raw = JSON.stringify({
        annotations: [
          {
            category: 'behavior', line_start: 1, line_end: 5, text: 'note',
            dependencies: [{ file: '/etc/passwd', relationship: 'reads' }],
          },
        ],
        critical_flags: [],
      });
      const result = parseScanOutput(raw);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].dependencies).toBeUndefined();
      dispose();
    });

    it('rejects path traversal in dependencies', () => {
      const { parseScanOutput, dispose } = getParser();
      const raw = JSON.stringify({
        annotations: [
          {
            category: 'behavior', line_start: 1, line_end: 5, text: 'note',
            dependencies: [{ file: '../../../etc/passwd', relationship: 'reads' }],
          },
        ],
        critical_flags: [],
      });
      const result = parseScanOutput(raw);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].dependencies).toBeUndefined();
      dispose();
    });

    it('accepts valid dependency paths', () => {
      const { parseScanOutput, dispose } = getParser();
      const raw = JSON.stringify({
        annotations: [
          {
            category: 'behavior', line_start: 1, line_end: 5, text: 'note',
            dependencies: [{ file: 'src/billing/calc.py', relationship: 'must stay in sync' }],
          },
        ],
        critical_flags: [],
      });
      const result = parseScanOutput(raw);
      expect(result.entries[0].dependencies).toHaveLength(1);
      expect(result.entries[0].dependencies![0].file).toBe('src/billing/calc.py');
      dispose();
    });

    it('validates dependency line ranges', () => {
      const { parseScanOutput, dispose } = getParser();
      const raw = JSON.stringify({
        annotations: [
          {
            category: 'behavior', line_start: 1, line_end: 5, text: 'note',
            dependencies: [{ file: 'src/foo.ts', relationship: 'related', line_start: -1, line_end: 10 }],
          },
        ],
        critical_flags: [],
      });
      const result = parseScanOutput(raw);
      expect(result.entries[0].dependencies![0].line_start).toBeUndefined();
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
      const store = new LoreStore();
      const lm = new LmService();
      const generator = new LoreGenerator(lm, store);
      const result = generator.formatExistingKnowledge('src/foo.ts');
      expect(result).toBe('');
      store.dispose();
    });

    it('includes annotations for the file', () => {
      const store = new LoreStore();
      const lm = new LmService();
      const generator = new LoreGenerator(lm, store);
      store.addAnnotation(makeAnnotation({ text: 'billing off-by-one is intentional' }));

      const result = generator.formatExistingKnowledge('src/foo.ts');
      expect(result).toContain('existing_knowledge');
      expect(result).toContain('billing off-by-one is intentional');
      expect(result).toContain('Behavior');
      expect(result).toContain('L10-20');
      store.dispose();
    });

    it('includes critical flags for the file', () => {
      const store = new LoreStore();
      const lm = new LmService();
      const generator = new LoreGenerator(lm, store);
      store.addCriticalFlag(makeFlag({ description: 'Token validation logic' }));

      const result = generator.formatExistingKnowledge('src/foo.ts');
      expect(result).toContain('Token validation logic');
      expect(result).toContain('critical');
      expect(result).toContain('unreviewed');
      store.dispose();
    });

    it('shows reviewed status for resolved critical flags', () => {
      const store = new LoreStore();
      const lm = new LmService();
      const generator = new LoreGenerator(lm, store);
      store.addCriticalFlag(makeFlag({ human_reviewed: true }));

      const result = generator.formatExistingKnowledge('src/foo.ts');
      expect(result).toContain('reviewed');
      expect(result).not.toContain('unreviewed');
      store.dispose();
    });

    it('does not include annotations for other files', () => {
      const store = new LoreStore();
      const lm = new LmService();
      const generator = new LoreGenerator(lm, store);
      store.addAnnotation(makeAnnotation({ file: 'src/other.ts', text: 'wrong file' }));

      const result = generator.formatExistingKnowledge('src/foo.ts');
      expect(result).toBe('');
      store.dispose();
    });

    it('includes both annotations and critical flags', () => {
      const store = new LoreStore();
      const lm = new LmService();
      const generator = new LoreGenerator(lm, store);
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
      const file = path.join(dir, '.codelore', 'components', `${id}.yaml`);
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
      const store = new LoreStore();
      const generator = new LoreGenerator(new LmService(), store);

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
      const store = new LoreStore();
      const generator = new LoreGenerator(new LmService(), store);
      expect(generator.formatComponentContext('src/foo.ts')).toBe('');
      store.dispose();
    });

    it('scanFile sends a full-file prompt and persists accepted entries and flags in one pass', async () => {
      writeComponent(tmpDir, 'billing', {
        id: 'billing', name: 'Billing',
        files: ['src/foo.ts'],
        source: 'human_authored',
        created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
      });

      const filePath = path.join(tmpDir, 'src/foo.ts');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, 'function charge() {\n  return 42;\n}\n', 'utf8');

      const store = new LoreStore();
      const lm = new LmService();
      let capturedPrompt = '';
      let calls = 0;
      (lm as any).generate = async (_system: string, user: string) => {
        capturedPrompt = user;
        calls++;
        return {
          text: JSON.stringify({
            annotations: [
              { category: 'behavior', line_start: 1, line_end: 3, text: 'charge returns a fixed amount', components: ['billing'] },
            ],
            critical_flags: [
              { line_start: 2, line_end: 2, severity: 'medium', description: 'hardcoded value' },
            ],
          }),
          modelName: 'stub/model',
        };
      };
      const generator = new LoreGenerator(lm, store);

      const editor = {
        document: {
          uri: Uri.file(filePath),
          getText: () => 'function charge() {\n  return 42;\n}\n',
        },
      };
      __setActiveTextEditor(editor);

      // Two sequential quick picks: first the annotation items, then the flag items.
      __queueQuickPick(
        [
          {
            entry: { category: 'behavior', line_start: 1, line_end: 3, text: 'charge returns a fixed amount', components: ['billing'] },
            overlapping: [],
          },
        ],
        [
          {
            region: { line_start: 2, line_end: 2, severity: 'medium', description: 'hardcoded value' },
          },
        ],
      );

      await generator.scanFile(editor as any);

      expect(calls).toBe(1);
      expect(capturedPrompt).toContain('<scope>full-file scan');
      expect(capturedPrompt).toContain('1: function charge()');
      expect(capturedPrompt).toContain('<components>');

      const storedAnnotations = store.getAnnotationsForFile('src/foo.ts');
      expect(storedAnnotations).toHaveLength(1);
      expect(storedAnnotations[0].source).toBe('ai_generated');
      expect(storedAnnotations[0].components).toEqual(['billing']);

      const storedFlags = store.getCriticalFlagsForFile('src/foo.ts');
      expect(storedFlags).toHaveLength(1);
      expect(storedFlags[0].severity).toBe('medium');
      expect(storedFlags[0].human_reviewed).toBe(false);
      store.dispose();
    });

    it('parseScanOutput keeps valid component ids and drops unknown ones', () => {
      writeComponent(tmpDir, 'billing', {
        id: 'billing', name: 'Billing', files: [],
        source: 'human_authored',
        created_at: '2026-04-18T00:00:00Z', updated_at: '2026-04-18T00:00:00Z',
      });
      const store = new LoreStore();
      const generator = new LoreGenerator(new LmService(), store);
      const raw = JSON.stringify({
        annotations: [
          {
            category: 'behavior', line_start: 1, line_end: 5, text: 'ok',
            components: ['billing', 'does-not-exist', 'billing'],
          },
          {
            category: 'rationale', line_start: 6, line_end: 10, text: 'untagged',
            components: [],
          },
        ],
        critical_flags: [],
      });
      const result = generator.parseScanOutput(raw);
      expect(result.entries[0].components).toEqual(['billing']);
      expect(result.entries[1].components).toBeUndefined();
      store.dispose();
    });
  });

  describe('scanFiles batch mode', () => {
    it('iterates files once and auto-persists both annotations and flags per file', async () => {
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
          text: JSON.stringify({
            annotations: [
              { category: 'behavior', line_start: 1, line_end: 1, text: `note for ${filePath}` },
            ],
            critical_flags: [
              { line_start: 1, line_end: 1, severity: 'high', description: `risk in ${filePath}` },
            ],
          }),
          modelName: 'stub/model',
        };
      };
      const generator = new LoreGenerator(lm, store);

      await generator.scanFiles(['src/a.ts', 'src/b.ts'], 'test scope');

      // One LLM call per file — not two.
      expect(seenPaths).toEqual(['src/a.ts', 'src/b.ts']);
      const a = store.getAnnotationsForFile('src/a.ts');
      const b = store.getAnnotationsForFile('src/b.ts');
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0].source).toBe('ai_generated');
      expect(a[0].text).toContain('src/a.ts');

      const aFlags = store.getCriticalFlagsForFile('src/a.ts');
      const bFlags = store.getCriticalFlagsForFile('src/b.ts');
      expect(aFlags).toHaveLength(1);
      expect(bFlags).toHaveLength(1);
      expect(aFlags[0].severity).toBe('high');
      expect(aFlags[0].human_reviewed).toBe(false);
      store.dispose();
    });

    it('skips missing files silently', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/real.ts'), 'export {};\n', 'utf8');

      const store = new LoreStore();
      const lm = new LmService();
      let calls = 0;
      (lm as any).generate = async () => {
        calls++;
        return { text: '{"annotations":[],"critical_flags":[]}', modelName: 'stub/model' };
      };
      const generator = new LoreGenerator(lm, store);

      await generator.scanFiles(['src/missing.ts', 'src/real.ts'], 'test');

      expect(calls).toBe(1);
      store.dispose();
    });

    it('skips empty files without calling the LM', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/empty.ts'), '', 'utf8');

      const store = new LoreStore();
      const lm = new LmService();
      let calls = 0;
      (lm as any).generate = async () => {
        calls++;
        return { text: '{"annotations":[],"critical_flags":[]}', modelName: 'stub/model' };
      };
      const generator = new LoreGenerator(lm, store);

      await generator.scanFiles(['src/empty.ts'], 'test');

      expect(calls).toBe(0);
      store.dispose();
    });

    it('continues batch on per-file LM failures', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/x.ts'), 'export const X = 1;\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'src/y.ts'), 'export const Y = 2;\n', 'utf8');

      const store = new LoreStore();
      const lm = new LmService();
      let i = 0;
      (lm as any).generate = async () => {
        if (i++ === 0) { throw new Error('boom'); }
        return {
          text: JSON.stringify({
            annotations: [{ category: 'behavior', line_start: 1, line_end: 1, text: 'ok' }],
            critical_flags: [],
          }),
          modelName: 'stub/model',
        };
      };
      const generator = new LoreGenerator(lm, store);

      await generator.scanFiles(['src/x.ts', 'src/y.ts'], 'test');

      expect(store.getAnnotationsForFile('src/x.ts')).toHaveLength(0);
      expect(store.getAnnotationsForFile('src/y.ts')).toHaveLength(1);
      store.dispose();
    });
  });
});
