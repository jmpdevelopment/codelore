import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { __setWorkspaceFolder, __clearWorkspace, __setConfig } from '../__mocks__/vscode';
import { DiaryStore } from '../../src/storage/diaryStore';
import { CATEGORY_META } from '../../src/models/annotation';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-cp-'));
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

describe('Copy annotations formatting', () => {
  it('formats annotations as readable text', () => {
    const store = new DiaryStore();
    store.addAnnotation({
      id: 'cp-1',
      file: 'src/auth.ts',
      line_start: 10,
      line_end: 20,
      category: 'verified',
      text: 'Token validation looks correct',
      source: 'human_authored',
      created_at: new Date().toISOString(),
    });
    store.addAnnotation({
      id: 'cp-2',
      file: 'src/auth.ts',
      line_start: 30,
      line_end: 40,
      category: 'needs_review',
      text: 'Rate limiting logic needs checking',
      source: 'human_authored',
      created_at: new Date().toISOString(),
    });

    const annotations = store.getAnnotationsForFile('src/auth.ts');
    const lines: string[] = [];
    lines.push(`# CodeDiary annotations for src/auth.ts`);
    lines.push('');
    lines.push('## Annotations');
    for (const ann of annotations) {
      lines.push(`- [L${ann.line_start}-${ann.line_end}] ${ann.category.toUpperCase()}: ${ann.text}`);
    }

    const output = lines.join('\n');
    expect(output).toContain('VERIFIED');
    expect(output).toContain('Token validation looks correct');
    expect(output).toContain('NEEDS_REVIEW');
    expect(output).toContain('L10-20');
    expect(output).toContain('L30-40');
    store.dispose();
  });

  it('includes critical flags in output', () => {
    const store = new DiaryStore();
    store.addCriticalFlag({
      file: 'src/auth.ts',
      line_start: 5,
      line_end: 15,
      severity: 'critical',
      human_reviewed: false,
      description: 'Authentication bypass risk',
    });

    const flags = store.getCriticalFlagsForFile('src/auth.ts');
    expect(flags).toHaveLength(1);

    const line = `- [L${flags[0].line_start}-${flags[0].line_end}] ${flags[0].severity.toUpperCase()} (UNREVIEWED): ${flags[0].description}`;
    expect(line).toContain('CRITICAL');
    expect(line).toContain('UNREVIEWED');
    expect(line).toContain('Authentication bypass risk');
    store.dispose();
  });

  it('shows resolved status for reviewed flags', () => {
    const store = new DiaryStore();
    store.addCriticalFlag({
      file: 'src/auth.ts',
      line_start: 5,
      line_end: 15,
      severity: 'high',
      human_reviewed: true,
      resolved_by: 'alice',
      resolution_comment: 'False positive',
    });

    const flags = store.getCriticalFlagsForFile('src/auth.ts');
    const status = flags[0].human_reviewed ? 'RESOLVED' : 'UNREVIEWED';
    expect(status).toBe('RESOLVED');
    store.dispose();
  });

  it('returns empty for file with no annotations', () => {
    const store = new DiaryStore();
    const annotations = store.getAnnotationsForFile('src/nonexistent.ts');
    const flags = store.getCriticalFlagsForFile('src/nonexistent.ts');
    expect(annotations).toHaveLength(0);
    expect(flags).toHaveLength(0);
    store.dispose();
  });
});
