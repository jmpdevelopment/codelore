import { describe, it, expect } from 'vitest';
import { rangesOverlap, groupKnowledgeByComponent } from '../../src/views/preCommitBriefProvider';
import { ChangedLineRange } from '../../src/utils/git';
import { Component } from '../../src/models/component';
import { Annotation } from '../../src/models/annotation';
import { CriticalFlag } from '../../src/models/criticalFlag';

function fk(file: string, opts: Partial<{
  overlappingCritical: CriticalFlag[];
  overlappingAnnotations: Annotation[];
  annotations: Annotation[];
  criticalFlags: CriticalFlag[];
}> = {}): any {
  return {
    filePath: file,
    annotations: opts.annotations ?? [],
    criticalFlags: opts.criticalFlags ?? [],
    reviewMarkers: [],
    changedRanges: [],
    overlappingAnnotations: opts.overlappingAnnotations ?? [],
    overlappingCritical: opts.overlappingCritical ?? [],
    incomingDependencies: [],
  };
}

function comp(id: string, name: string, files: string[]): Component {
  return {
    id, name, files,
    source: 'human_authored',
    created_at: '2026-04-18T00:00:00Z',
    updated_at: '2026-04-18T00:00:00Z',
  };
}

describe('rangesOverlap', () => {
  const ranges: ChangedLineRange[] = [
    { start: 10, count: 5 },   // lines 10-14
    { start: 30, count: 3 },   // lines 30-32
  ];

  it('detects overlap when item fully inside changed range', () => {
    expect(rangesOverlap(11, 13, ranges)).toBe(true);
  });

  it('detects overlap when item partially overlaps start', () => {
    expect(rangesOverlap(8, 11, ranges)).toBe(true);
  });

  it('detects overlap when item partially overlaps end', () => {
    expect(rangesOverlap(13, 18, ranges)).toBe(true);
  });

  it('detects overlap when item contains changed range', () => {
    expect(rangesOverlap(5, 20, ranges)).toBe(true);
  });

  it('detects overlap with second range', () => {
    expect(rangesOverlap(31, 35, ranges)).toBe(true);
  });

  it('returns false when no overlap', () => {
    expect(rangesOverlap(15, 29, ranges)).toBe(false);
  });

  it('returns false when item is before all ranges', () => {
    expect(rangesOverlap(1, 5, ranges)).toBe(false);
  });

  it('returns false when item is after all ranges', () => {
    expect(rangesOverlap(40, 50, ranges)).toBe(false);
  });

  it('detects overlap at exact boundary (item end = range start)', () => {
    expect(rangesOverlap(8, 10, ranges)).toBe(true);
  });

  it('detects overlap at exact boundary (item start = range end)', () => {
    expect(rangesOverlap(14, 20, ranges)).toBe(true);
  });

  it('returns false with empty changed ranges', () => {
    expect(rangesOverlap(1, 100, [])).toBe(false);
  });

  it('handles single-line items', () => {
    expect(rangesOverlap(12, 12, ranges)).toBe(true);
    expect(rangesOverlap(20, 20, ranges)).toBe(false);
  });

  it('handles single-line changed ranges', () => {
    const singleLine: ChangedLineRange[] = [{ start: 5, count: 1 }];
    expect(rangesOverlap(5, 5, singleLine)).toBe(true);
    expect(rangesOverlap(4, 4, singleLine)).toBe(false);
    expect(rangesOverlap(6, 6, singleLine)).toBe(false);
  });
});

describe('groupKnowledgeByComponent', () => {
  it('places files into the component groups they belong to', () => {
    const components = [
      comp('billing', 'Billing', ['src/billing/calc.ts']),
      comp('auth', 'Auth', ['src/auth/login.ts']),
    ];
    const knowledge = [
      fk('src/billing/calc.ts'),
      fk('src/auth/login.ts'),
    ];
    const groups = groupKnowledgeByComponent(knowledge, components);
    const billing = groups.find(g => g.componentId === 'billing')!;
    const auth = groups.find(g => g.componentId === 'auth')!;
    expect(billing.knowledge.map(k => k.filePath)).toEqual(['src/billing/calc.ts']);
    expect(auth.knowledge.map(k => k.filePath)).toEqual(['src/auth/login.ts']);
  });

  it('places untagged files into a trailing Untagged bucket', () => {
    const components = [comp('billing', 'Billing', ['src/billing/calc.ts'])];
    const knowledge = [
      fk('src/billing/calc.ts'),
      fk('src/random/util.ts'),
    ];
    const groups = groupKnowledgeByComponent(knowledge, components);
    expect(groups[groups.length - 1].componentId).toBe(null);
    expect(groups[groups.length - 1].knowledge.map(k => k.filePath)).toEqual(['src/random/util.ts']);
  });

  it('duplicates a file into every component that lists it', () => {
    const components = [
      comp('billing', 'Billing', ['src/shared.ts']),
      comp('reporting', 'Reporting', ['src/shared.ts']),
    ];
    const knowledge = [fk('src/shared.ts')];
    const groups = groupKnowledgeByComponent(knowledge, components);
    expect(groups.find(g => g.componentId === 'billing')?.knowledge).toHaveLength(1);
    expect(groups.find(g => g.componentId === 'reporting')?.knowledge).toHaveLength(1);
  });

  it('sorts groups: critical first, then file count, then name; untagged always last', () => {
    const components = [
      comp('quiet', 'Quiet', ['src/q.ts']),
      comp('busy', 'Busy', ['src/b1.ts', 'src/b2.ts']),
      comp('hot', 'Hot', ['src/h.ts']),
    ];
    const flag: CriticalFlag = {
      file: 'src/h.ts', line_start: 1, line_end: 5,
      severity: 'critical', description: 'x', human_reviewed: false,
    };
    const knowledge = [
      fk('src/q.ts'),
      fk('src/b1.ts'), fk('src/b2.ts'),
      fk('src/h.ts', { overlappingCritical: [flag] }),
      fk('src/untagged.ts'),
    ];
    const groups = groupKnowledgeByComponent(knowledge, components);
    expect(groups.map(g => g.componentId)).toEqual(['hot', 'busy', 'quiet', null]);
  });

  it('returns no groups for empty knowledge', () => {
    expect(groupKnowledgeByComponent([], [comp('x', 'X', [])])).toEqual([]);
  });
});
