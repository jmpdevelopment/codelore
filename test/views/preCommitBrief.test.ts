import { describe, it, expect } from 'vitest';
import { rangesOverlap } from '../../src/views/preCommitBriefProvider';
import { ChangedLineRange } from '../../src/utils/git';

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
