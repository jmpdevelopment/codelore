import { describe, it, expect } from 'vitest';
import { parseChangedLineRanges, rangesOverlap, ChangedLineRange } from '../../src/utils/git';

describe('parseChangedLineRanges', () => {
  it('parses single hunk with count', () => {
    const diff = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,5 +10,8 @@ function foo() {
+  new line
+  another line
   existing`;

    const ranges = parseChangedLineRanges(diff);
    expect(ranges).toEqual([{ start: 10, count: 8 }]);
  });

  it('parses multiple hunks', () => {
    const diff = `@@ -1,3 +1,4 @@
+added
 existing
@@ -20,5 +21,7 @@ function bar() {
+more
 existing`;

    const ranges = parseChangedLineRanges(diff);
    expect(ranges).toEqual([
      { start: 1, count: 4 },
      { start: 21, count: 7 },
    ]);
  });

  it('parses hunk with count of 1 (no comma)', () => {
    const diff = '@@ -5,3 +5 @@ function baz()\n existing';
    const ranges = parseChangedLineRanges(diff);
    expect(ranges).toEqual([{ start: 5, count: 1 }]);
  });

  it('skips hunks with zero count (deletions only)', () => {
    const diff = '@@ -10,3 +9,0 @@\n-deleted line';
    const ranges = parseChangedLineRanges(diff);
    expect(ranges).toEqual([]);
  });

  it('returns empty for non-diff text', () => {
    const ranges = parseChangedLineRanges('just some text');
    expect(ranges).toEqual([]);
  });

  it('returns empty for empty string', () => {
    const ranges = parseChangedLineRanges('');
    expect(ranges).toEqual([]);
  });

  it('handles real-world diff output', () => {
    const diff = `diff --git a/src/utils/git.ts b/src/utils/git.ts
index 1234567..abcdefg 100644
--- a/src/utils/git.ts
+++ b/src/utils/git.ts
@@ -35,0 +36,20 @@ export function gitDiffAll(cwd: string): string | undefined {
+export function gitChangedFiles(cwd: string): string[] {
+  try {
@@ -42,3 +63,15 @@ export function gitDiffAll(cwd: string): string | undefined {
+export function parseChangedLineRanges(diff: string): ChangedLineRange[] {`;

    const ranges = parseChangedLineRanges(diff);
    expect(ranges).toEqual([
      { start: 36, count: 20 },
      { start: 63, count: 15 },
    ]);
  });
});

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
