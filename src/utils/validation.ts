import { AnnotationCategory, ANNOTATION_CATEGORIES } from '../models/annotation';
import { CriticalSeverity } from '../models/criticalFlag';

const VALID_SEVERITIES: CriticalSeverity[] = ['critical', 'high', 'medium'];

/**
 * Validates and coerces a line number to a positive integer.
 * Returns undefined if the value is not a valid line number.
 */
export function validLineNumber(value: unknown): number | undefined {
  if (typeof value === 'string') { value = Number(value); }
  if (typeof value !== 'number' || !Number.isFinite(value)) { return undefined; }
  const n = Math.floor(value);
  return n >= 1 ? n : undefined;
}

/**
 * Validates that line_start and line_end form a valid range.
 * Coerces string values to numbers. Returns normalized values or undefined.
 */
export function validLineRange(lineStart: unknown, lineEnd: unknown): { line_start: number; line_end: number } | undefined {
  const start = validLineNumber(lineStart);
  if (start === undefined) { return undefined; }
  const end = validLineNumber(lineEnd) ?? start;
  return { line_start: start, line_end: Math.max(start, end) };
}

export function isValidCategory(value: unknown): value is AnnotationCategory {
  return typeof value === 'string' && (ANNOTATION_CATEGORIES as readonly string[]).includes(value);
}

export function isValidSeverity(value: unknown): value is CriticalSeverity {
  return typeof value === 'string' && VALID_SEVERITIES.includes(value as CriticalSeverity);
}

/**
 * Counts unique lines covered by a set of ranges, handling overlaps.
 */
export function countUniqueLines(ranges: Array<{ line_start: number; line_end: number }>): number {
  if (ranges.length === 0) { return 0; }

  // Sort by start, then merge overlapping intervals
  const sorted = [...ranges].sort((a, b) => a.line_start - b.line_start);
  const merged: Array<{ start: number; end: number }> = [];

  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.line_start <= last.end + 1) {
      last.end = Math.max(last.end, r.line_end);
    } else {
      merged.push({ start: r.line_start, end: r.line_end });
    }
  }

  return merged.reduce((sum, m) => sum + (m.end - m.start + 1), 0);
}
