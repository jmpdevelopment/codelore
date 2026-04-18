import { describe, it, expect } from 'vitest';
import {
  ANNOTATION_CATEGORIES,
  CATEGORY_META,
  normalizeSource,
  type AnnotationCategory,
  type AnnotationSource,
  type Annotation,
  type FileDependency,
} from '../../src/models/annotation';
import { type ReviewMarker, mergeReviewMarkers } from '../../src/models/reviewMarker';
import type { CriticalFlag, CriticalSeverity } from '../../src/models/criticalFlag';

describe('Annotation model', () => {
  it('has exactly 9 categories', () => {
    expect(ANNOTATION_CATEGORIES).toHaveLength(9);
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
      'hallucination', 'intent', 'accepted', 'business_rule', 'ai_prompt',
    ]);
  });

  it('business_rule category has metadata', () => {
    const meta = CATEGORY_META.business_rule;
    expect(meta.label).toBe('Business Rule');
    expect(meta.icon).toBeTruthy();
    expect(meta.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(meta.description).toContain('business rule');
  });

  it('Annotation interface accepts valid data', () => {
    const a: Annotation = {
      id: 'test-id',
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 10,
      category: 'verified',
      text: 'test',
      source: 'human_authored',
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(a.id).toBe('test-id');
  });

  it('AnnotationSource covers all expected values', () => {
    const sources: AnnotationSource[] = ['ai_generated', 'ai_verified', 'human_authored'];
    expect(sources).toHaveLength(3);
  });

  it('supports optional verified_by / verified_at fields', () => {
    const a: Annotation = {
      id: 'test-verified',
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 10,
      category: 'verified',
      text: 'AI-written, human-confirmed',
      source: 'ai_verified',
      created_at: '2026-01-01T00:00:00Z',
      verified_by: 'alice@example.com',
      verified_at: '2026-04-18T09:00:00Z',
    };
    expect(a.verified_by).toBe('alice@example.com');
    expect(a.verified_at).toBe('2026-04-18T09:00:00Z');
  });

  it('supports optional dependencies field', () => {
    const deps: FileDependency[] = [
      { file: 'src/billing/calc.py', relationship: 'must stay in sync' },
      { file: 'src/reporting/monthly.py', line_start: 10, line_end: 20, relationship: 'reads from this calculation' },
    ];
    const a: Annotation = {
      id: 'test-dep',
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 10,
      category: 'business_rule',
      text: 'Billing calculation with cross-file dependency',
      source: 'human_authored',
      created_at: '2026-01-01T00:00:00Z',
      dependencies: deps,
    };
    expect(a.dependencies).toHaveLength(2);
    expect(a.dependencies![0].relationship).toBe('must stay in sync');
    expect(a.dependencies![1].line_start).toBe(10);
  });

  it('supports optional signature_hash in anchor', () => {
    const a: Annotation = {
      id: 'test-sig',
      file: 'src/foo.ts',
      line_start: 1,
      line_end: 10,
      category: 'verified',
      text: 'test',
      source: 'human_authored',
      created_at: '2026-01-01T00:00:00Z',
      anchor: { content_hash: 'abc123', signature_hash: 'def456', stale: false },
    };
    expect(a.anchor!.signature_hash).toBe('def456');
  });
});

describe('normalizeSource', () => {
  it('maps legacy manual to human_authored', () => {
    expect(normalizeSource('manual')).toBe('human_authored');
  });

  it('maps legacy ai_suggested to ai_generated', () => {
    expect(normalizeSource('ai_suggested')).toBe('ai_generated');
  });

  it('maps legacy ai_accepted to ai_verified', () => {
    expect(normalizeSource('ai_accepted')).toBe('ai_verified');
  });

  it('passes through current values unchanged', () => {
    expect(normalizeSource('ai_generated')).toBe('ai_generated');
    expect(normalizeSource('ai_verified')).toBe('ai_verified');
    expect(normalizeSource('human_authored')).toBe('human_authored');
  });

  it('falls back to human_authored for unknown or malformed values', () => {
    expect(normalizeSource(undefined)).toBe('human_authored');
    expect(normalizeSource('something_else')).toBe('human_authored');
    expect(normalizeSource(42)).toBe('human_authored');
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

describe('mergeReviewMarkers', () => {
  const marker = (start: number, end: number): ReviewMarker => ({
    file: 'src/foo.ts',
    line_start: start,
    line_end: end,
    reviewer: 'alice',
    reviewed_at: '2026-01-01T00:00:00Z',
  });

  it('adds to empty list', () => {
    const result = mergeReviewMarkers([], marker(10, 20));
    expect(result).toHaveLength(1);
    expect(result[0].line_start).toBe(10);
    expect(result[0].line_end).toBe(20);
  });

  it('keeps non-overlapping markers', () => {
    const existing = [marker(1, 5)];
    const result = mergeReviewMarkers(existing, marker(10, 20));
    expect(result).toHaveLength(2);
  });

  it('merges overlapping markers', () => {
    const existing = [marker(5, 15)];
    const result = mergeReviewMarkers(existing, marker(10, 20));
    expect(result).toHaveLength(1);
    expect(result[0].line_start).toBe(5);
    expect(result[0].line_end).toBe(20);
  });

  it('merges adjacent markers', () => {
    const existing = [marker(1, 10)];
    const result = mergeReviewMarkers(existing, marker(10, 20));
    expect(result).toHaveLength(1);
    expect(result[0].line_start).toBe(1);
    expect(result[0].line_end).toBe(20);
  });

  it('merges multiple overlapping markers', () => {
    const existing = [marker(1, 5), marker(8, 12), marker(30, 40)];
    const result = mergeReviewMarkers(existing, marker(4, 15));
    expect(result).toHaveLength(2); // non-overlapping 30-40 + merged 1-15
    const merged = result.find(m => m.line_start === 1);
    expect(merged).toBeDefined();
    expect(merged!.line_end).toBe(15);
  });

  it('handles contained marker', () => {
    const existing = [marker(1, 50)];
    const result = mergeReviewMarkers(existing, marker(10, 20));
    expect(result).toHaveLength(1);
    expect(result[0].line_start).toBe(1);
    expect(result[0].line_end).toBe(50);
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
