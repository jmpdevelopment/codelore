import { describe, it, expect } from 'vitest';
import { parseChangedLineRanges } from '../../src/utils/git';

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
