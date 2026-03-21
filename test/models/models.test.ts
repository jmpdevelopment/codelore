import { describe, it, expect } from 'vitest';
import {
  ANNOTATION_CATEGORIES,
  CATEGORY_META,
  type AnnotationCategory,
  type AnnotationSource,
  type Annotation,
} from '../../src/models/annotation';
import type { ReviewMarker } from '../../src/models/reviewMarker';
import type { CriticalFlag, CriticalSeverity } from '../../src/models/criticalFlag';

describe('Annotation model', () => {
  it('has exactly 8 categories', () => {
    expect(ANNOTATION_CATEGORIES).toHaveLength(8);
  });

  it('all categories have metadata', () => {
    for (const cat of ANNOTATION_CATEGORIES) {
      const meta = CATEGORY_META[cat];
      expect(meta).toBeDefined();
      expect(meta.label).toBeTruthy();
      expect(meta.icon).toBeTruthy();
      expect(meta.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(meta.description).toBeTruthy();
    }
  });

  it('categories are the expected set', () => {
    expect(ANNOTATION_CATEGORIES).toEqual([
      'verified', 'needs_review', 'modified', 'confused',
      'hallucination', 'intent', 'accepted', 'ai_prompt',
    ]);
  });

  it('Annotation interface accepts valid data', () => {
    const a: Annotation = {
      id: 'test-id',
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 10,
      category: 'verified',
      text: 'test',
      source: 'manual',
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(a.id).toBe('test-id');
  });

  it('AnnotationSource covers all expected values', () => {
    const sources: AnnotationSource[] = ['manual', 'ai_suggested', 'ai_accepted'];
    expect(sources).toHaveLength(3);
  });
});

describe('ReviewMarker model', () => {
  it('accepts valid data', () => {
    const m: ReviewMarker = {
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 50,
      reviewer: 'alice',
      reviewed_at: '2026-01-01T00:00:00Z',
    };
    expect(m.reviewer).toBe('alice');
  });

  it('supports optional commit_hash', () => {
    const m: ReviewMarker = {
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 50,
      reviewer: 'alice',
      reviewed_at: '2026-01-01T00:00:00Z',
      commit_hash: 'abc123',
    };
    expect(m.commit_hash).toBe('abc123');
  });
});

describe('CriticalFlag model', () => {
  it('accepts valid data', () => {
    const f: CriticalFlag = {
      file: 'src/auth.ts',
      line_start: 10,
      line_end: 20,
      severity: 'critical',
      human_reviewed: false,
    };
    expect(f.severity).toBe('critical');
  });

  it('severity covers all expected values', () => {
    const severities: CriticalSeverity[] = ['critical', 'high', 'medium'];
    expect(severities).toHaveLength(3);
  });

  it('supports resolution fields', () => {
    const f: CriticalFlag = {
      file: 'src/auth.ts',
      line_start: 10,
      line_end: 20,
      severity: 'critical',
      human_reviewed: true,
      resolved_by: 'bob',
      resolved_at: '2026-03-21T10:00:00Z',
      resolution_comment: 'False positive',
    };
    expect(f.resolved_by).toBe('bob');
    expect(f.resolution_comment).toBe('False positive');
  });
});
