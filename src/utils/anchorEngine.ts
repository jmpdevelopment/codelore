import * as crypto from 'crypto';
import { ContentAnchor } from '../models/annotation';

/**
 * Patterns that identify function/class/method signature lines.
 * Supports Python (def, class, async def) and TypeScript/JavaScript
 * (function, class, export function, async function, arrow functions, methods).
 */
const SIGNATURE_PATTERNS = [
  // Python: def, async def, class
  /^\s*(async\s+)?def\s+\w+/,
  /^\s*class\s+\w+/,
  // TypeScript/JavaScript: function, export function, async function
  /^\s*(export\s+)?(async\s+)?function\s+\w+/,
  // TS/JS: class declarations
  /^\s*(export\s+)?(abstract\s+)?class\s+\w+/,
  // TS/JS: method definitions (name followed by parens, possibly with async/static/get/set)
  /^\s*(static\s+)?(async\s+)?(get\s+|set\s+)?\w+\s*\(/,
  // TS/JS: arrow function assigned to const/let/var
  /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/,
];

/**
 * Compute a content hash for the given lines (1-based line_start/line_end).
 * Trims each line and ignores empty lines so whitespace changes don't break anchoring.
 */
export function computeContentHash(fileLines: string[], lineStart: number, lineEnd: number): string {
  const regionLines = fileLines.slice(lineStart - 1, lineEnd);
  const normalized = regionLines
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join('\n');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Extract the signature line from a code region (first line matching a known pattern).
 * Returns the trimmed signature line, or undefined if no signature is found.
 */
export function extractSignature(fileLines: string[], lineStart: number, lineEnd: number): string | undefined {
  const region = fileLines.slice(lineStart - 1, lineEnd);
  for (const line of region) {
    const trimmed = line.trim();
    if (trimmed.length === 0) { continue; }
    for (const pattern of SIGNATURE_PATTERNS) {
      if (pattern.test(line)) {
        return trimmed;
      }
    }
  }
  return undefined;
}

/**
 * Compute a hash of the function/class signature within the annotated region.
 * Returns undefined if no recognizable signature is found.
 */
export function computeSignatureHash(fileLines: string[], lineStart: number, lineEnd: number): string | undefined {
  const sig = extractSignature(fileLines, lineStart, lineEnd);
  if (!sig) { return undefined; }
  return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
}

/**
 * Search the file for lines matching a signature hash.
 * Returns the line number (1-based) of the best match closest to originalLine.
 */
export function findBySignature(
  fileLines: string[],
  originalLineStart: number,
  signatureHash: string,
): number | undefined {
  const candidates: { line: number; distance: number }[] = [];

  for (let i = 0; i < fileLines.length; i++) {
    const trimmed = fileLines[i].trim();
    if (trimmed.length === 0) { continue; }
    let isSignature = false;
    for (const pattern of SIGNATURE_PATTERNS) {
      if (pattern.test(fileLines[i])) {
        isSignature = true;
        break;
      }
    }
    if (!isSignature) { continue; }
    const hash = crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 16);
    if (hash === signatureHash) {
      candidates.push({ line: i + 1, distance: Math.abs(i + 1 - originalLineStart) });
    }
  }

  if (candidates.length === 0) { return undefined; }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0].line;
}

/**
 * Verify whether the content at the stored line range still matches the hash.
 */
export function verifyAnchor(
  fileLines: string[],
  lineStart: number,
  lineEnd: number,
  expectedHash: string,
): boolean {
  if (lineStart < 1 || lineEnd > fileLines.length) { return false; }
  const currentHash = computeContentHash(fileLines, lineStart, lineEnd);
  return currentHash === expectedHash;
}

export interface ReanchorCandidate {
  line_start: number;
  line_end: number;
  confidence: 'exact' | 'high' | 'low';
}

/**
 * Search the file for the best location matching the original content hash.
 *
 * Strategy:
 * 1. Try sliding the same-size window across the file looking for an exact hash match.
 * 2. If no exact match but a signature_hash is provided, search for the signature
 *    as a fallback — the body changed but the function/class declaration is intact.
 * 3. If neither matches, return undefined.
 *
 * This handles line shifts (insertions/deletions above the region) perfectly,
 * and handles moves within the file.
 */
export function findReanchorCandidate(
  fileLines: string[],
  originalLineStart: number,
  originalLineEnd: number,
  expectedHash: string,
  signatureHash?: string,
): ReanchorCandidate | undefined {
  const regionSize = originalLineEnd - originalLineStart + 1;
  if (regionSize < 1 || fileLines.length < regionSize) { return undefined; }

  // Strategy 1: exact content hash match (sliding window)
  const candidates: { start: number; distance: number }[] = [];

  for (let start = 1; start <= fileLines.length - regionSize + 1; start++) {
    const end = start + regionSize - 1;
    const hash = computeContentHash(fileLines, start, end);
    if (hash === expectedHash) {
      candidates.push({ start, distance: Math.abs(start - originalLineStart) });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => a.distance - b.distance);
    const best = candidates[0];
    return {
      line_start: best.start,
      line_end: best.start + regionSize - 1,
      confidence: best.distance === 0 ? 'exact' : 'high',
    };
  }

  // Strategy 2: signature-based fallback — body changed but signature intact
  if (signatureHash) {
    const sigLine = findBySignature(fileLines, originalLineStart, signatureHash);
    if (sigLine !== undefined) {
      // Anchor to the same region size starting from the signature line
      const newEnd = Math.min(sigLine + regionSize - 1, fileLines.length);
      return {
        line_start: sigLine,
        line_end: newEnd,
        confidence: 'low',
      };
    }
  }

  return undefined;
}

/**
 * Check all annotations/flags for a file and return which ones are stale
 * and what their suggested re-anchor positions are.
 */
export interface AnchorCheckResult {
  id: string;
  currentLineStart: number;
  currentLineEnd: number;
  stale: boolean;
  candidate?: ReanchorCandidate;
}

export function checkAnchors(
  fileLines: string[],
  items: Array<{
    id: string;
    line_start: number;
    line_end: number;
    anchor?: ContentAnchor;
  }>,
): AnchorCheckResult[] {
  const results: AnchorCheckResult[] = [];

  for (const item of items) {
    if (!item.anchor?.content_hash) {
      // No anchor stored — skip, not stale (legacy annotation)
      continue;
    }

    const valid = verifyAnchor(fileLines, item.line_start, item.line_end, item.anchor.content_hash);

    if (valid) {
      results.push({
        id: item.id,
        currentLineStart: item.line_start,
        currentLineEnd: item.line_end,
        stale: false,
      });
      continue;
    }

    // Content moved or changed — try to find it (with signature fallback)
    const candidate = findReanchorCandidate(
      fileLines,
      item.line_start,
      item.line_end,
      item.anchor.content_hash,
      item.anchor.signature_hash,
    );

    results.push({
      id: item.id,
      currentLineStart: item.line_start,
      currentLineEnd: item.line_end,
      stale: true,
      candidate,
    });
  }

  return results;
}
