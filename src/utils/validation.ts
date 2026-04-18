import * as path from 'path';
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
 * Validates that a stored file path is safe to use:
 * - Must be relative (no leading / or drive letter)
 * - Must not contain .. segments
 * - Must not be empty
 */
export function isSafeRelativePath(filePath: string): boolean {
  if (!filePath || filePath.trim() === '') { return false; }
  if (path.isAbsolute(filePath)) { return false; }
  const normalized = path.normalize(filePath);
  if (normalized.startsWith('..') || normalized.includes(`${path.sep}..`)) { return false; }
  return true;
}

/**
 * Strip markdown code fences from LLM JSON responses.
 */
export function stripJsonFences(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/gm, '').replace(/\n?```$/gm, '').trim();
}

/**
 * Truncate text to maxLen characters, adding "..." if truncated.
 */
export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) { return text; }
  return text.substring(0, maxLen) + '...';
}

/**
 * Escape text for display in MarkdownString to prevent command injection.
 * Strips markdown link syntax that could embed command: URIs.
 */
export function sanitizeMarkdownText(text: string): string {
  // Remove markdown links that could contain command: or other dangerous URIs
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}
