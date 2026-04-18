import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { SCHEMA_VERSION } from '../../src/storage/schema';
import {
  migrateDocument,
  migrateYamlFile,
  migrateWorkspace,
} from '../../src/storage/migration';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-migrate-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeSharedYaml(relative: string, data: unknown): string {
  const full = path.join(tmpDir, '.codediary', relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, yaml.dump(data), 'utf8');
  return full;
}

function writePersonalYaml(data: unknown): string {
  const full = path.join(tmpDir, '.vscode', 'codediary.yaml');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, yaml.dump(data), 'utf8');
  return full;
}

describe('migrateDocument', () => {
  it('remaps hallucination → gotcha', () => {
    const doc: Record<string, unknown> = {
      annotations: [
        { id: '1', category: 'hallucination', source: 'manual' },
      ],
    };
    const result = migrateDocument(doc);
    expect(result.annotationsRemapped).toBe(1);
    expect(result.sourcesNormalized).toBe(1);
    expect(result.changed).toBe(true);
    expect((doc.annotations as any[])[0].category).toBe('gotcha');
    expect((doc.annotations as any[])[0].source).toBe('human_authored');
    expect(doc.version).toBe(SCHEMA_VERSION);
  });

  it('remaps intent → rationale', () => {
    const doc: Record<string, unknown> = {
      annotations: [{ id: '1', category: 'intent', source: 'ai_suggested' }],
    };
    migrateDocument(doc);
    expect((doc.annotations as any[])[0].category).toBe('rationale');
    expect((doc.annotations as any[])[0].source).toBe('ai_generated');
  });

  it('remaps accepted/verified/needs_review/modified/confused → human_note', () => {
    const doc: Record<string, unknown> = {
      annotations: [
        { category: 'accepted' },
        { category: 'verified' },
        { category: 'needs_review' },
        { category: 'modified' },
        { category: 'confused' },
      ],
    };
    migrateDocument(doc);
    const categories = (doc.annotations as any[]).map(a => a.category);
    expect(categories).toEqual(['human_note', 'human_note', 'human_note', 'human_note', 'human_note']);
  });

  it('preserves knowledge categories unchanged', () => {
    const doc: Record<string, unknown> = {
      annotations: [
        { category: 'behavior', source: 'human_authored' },
        { category: 'gotcha', source: 'ai_generated' },
      ],
    };
    const result = migrateDocument(doc);
    expect(result.annotationsRemapped).toBe(0);
    expect(result.sourcesNormalized).toBe(0);
    // Only the version bump is a change (v1 → v2)
    expect(result.changed).toBe(true);
    expect((doc.annotations as any[]).map(a => a.category)).toEqual(['behavior', 'gotcha']);
  });

  it('leaves a clean v2 document completely unchanged', () => {
    const doc: Record<string, unknown> = {
      version: SCHEMA_VERSION,
      annotations: [{ category: 'behavior', source: 'human_authored' }],
    };
    const result = migrateDocument(doc);
    expect(result.changed).toBe(false);
    expect(result.annotationsRemapped).toBe(0);
    expect(result.sourcesNormalized).toBe(0);
  });

  it('handles missing annotations array', () => {
    const doc: Record<string, unknown> = { narrative: 'nothing here' };
    const result = migrateDocument(doc);
    expect(result.annotationsRemapped).toBe(0);
    expect(result.changed).toBe(true); // version bump
    expect(doc.version).toBe(SCHEMA_VERSION);
  });
});

describe('migrateYamlFile', () => {
  it('rewrites a v1 file with legacy categories', () => {
    const filePath = writeSharedYaml('src/foo.ts.yaml', {
      annotations: [
        {
          id: 'a1',
          file: 'src/foo.ts',
          line_start: 1,
          line_end: 10,
          category: 'hallucination',
          text: 'suspect api call',
          source: 'ai_suggested',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    });

    const result = migrateYamlFile(filePath);
    expect(result.migrated).toBe(true);
    expect(result.annotationsRemapped).toBe(1);
    expect(result.sourcesNormalized).toBe(1);

    const reloaded = yaml.load(fs.readFileSync(filePath, 'utf8')) as any;
    expect(reloaded.version).toBe(SCHEMA_VERSION);
    expect(reloaded.annotations[0].category).toBe('gotcha');
    expect(reloaded.annotations[0].source).toBe('ai_generated');
  });

  it('is idempotent — second run does not rewrite the file', () => {
    const filePath = writeSharedYaml('src/foo.ts.yaml', {
      annotations: [{ id: 'a1', category: 'accepted', source: 'manual' }],
    });

    migrateYamlFile(filePath);
    const firstMtime = fs.statSync(filePath).mtimeMs;
    const firstContent = fs.readFileSync(filePath, 'utf8');

    const second = migrateYamlFile(filePath);
    expect(second.migrated).toBe(false);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(firstContent);
    // mtime may or may not change depending on FS, but contents must match
    expect(fs.statSync(filePath).mtimeMs).toBe(firstMtime);
  });

  it('does not rewrite an already-clean v2 file', () => {
    const filePath = writeSharedYaml('src/foo.ts.yaml', {
      version: SCHEMA_VERSION,
      annotations: [
        {
          id: 'a1',
          category: 'behavior',
          source: 'human_authored',
        },
      ],
    });
    const before = fs.readFileSync(filePath, 'utf8');
    const result = migrateYamlFile(filePath);
    expect(result.migrated).toBe(false);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
  });
});

describe('migrateWorkspace', () => {
  it('walks shared + personal stores and produces an aggregate report', () => {
    writeSharedYaml('src/foo.ts.yaml', {
      annotations: [
        { id: 'a1', category: 'hallucination', source: 'ai_suggested' },
        { id: 'a2', category: 'intent', source: 'manual' },
      ],
    });
    writeSharedYaml('src/bar.ts.yaml', {
      annotations: [{ id: 'b1', category: 'accepted', source: 'ai_accepted' }],
    });
    writePersonalYaml({
      annotations: [{ id: 'p1', category: 'needs_review', source: 'manual' }],
    });

    const report = migrateWorkspace(tmpDir);
    expect(report.filesScanned).toBe(3);
    expect(report.filesWritten).toBe(3);
    expect(report.annotationsRemapped).toBe(4);
    expect(report.sourcesNormalized).toBe(4);

    // Second pass: everything is already v2 — report should be all zeros for writes
    const second = migrateWorkspace(tmpDir);
    expect(second.filesScanned).toBe(3);
    expect(second.filesWritten).toBe(0);
    expect(second.annotationsRemapped).toBe(0);
    expect(second.sourcesNormalized).toBe(0);
  });

  it('handles missing .codediary/ and personal file gracefully', () => {
    const report = migrateWorkspace(tmpDir);
    expect(report).toEqual({
      filesScanned: 0,
      filesWritten: 0,
      annotationsRemapped: 0,
      sourcesNormalized: 0,
    });
  });

  it('migrates nested directories under .codediary/', () => {
    writeSharedYaml('src/deep/nested/file.ts.yaml', {
      annotations: [{ id: 'n1', category: 'confused', source: 'manual' }],
    });

    const report = migrateWorkspace(tmpDir);
    expect(report.filesScanned).toBe(1);
    expect(report.filesWritten).toBe(1);
    expect(report.annotationsRemapped).toBe(1);
  });

  it('writes version as the first key in the YAML output', () => {
    const filePath = writeSharedYaml('src/foo.ts.yaml', {
      annotations: [{ id: 'a1', category: 'intent', source: 'manual' }],
    });
    migrateYamlFile(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content.startsWith('version:')).toBe(true);
  });
});
