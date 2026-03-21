import * as crypto from 'crypto';

/** Stored alongside an annotation or critical flag for drift detection. */
export interface ContentAnchor {
  /** Hash of the trimmed, non-empty lines in the annotated region. */
  content_hash: string;
  /** Whether the anchor no longer matches the file content. */
  stale: boolean;
}

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
 * 2. If no exact match, return undefined — the content has been edited or deleted.
 *
 * This handles line shifts (insertions/deletions above the region) perfectly,
 * and handles moves within the file.
 */
export function findReanchorCandidate(
  fileLines: string[],
  originalLineStart: number,
  originalLineEnd: number,
  expectedHash: string,
): ReanchorCandidate | undefined {
  const regionSize = originalLineEnd - originalLineStart + 1;
  if (regionSize < 1 || fileLines.length < regionSize) { return undefined; }

  // Search outward from original position for best locality
  const candidates: { start: number; distance: number }[] = [];

  for (let start = 1; start <= fileLines.length - regionSize + 1; start++) {
    const end = start + regionSize - 1;
    const hash = computeContentHash(fileLines, start, end);
    if (hash === expectedHash) {
      candidates.push({ start, distance: Math.abs(start - originalLineStart) });
    }
  }

  if (candidates.length === 0) { return undefined; }

  // Pick the candidate closest to the original position
  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];

  return {
    line_start: best.start,
    line_end: best.start + regionSize - 1,
    confidence: best.distance === 0 ? 'exact' : 'high',
  };
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

    // Content moved or changed — try to find it
    const candidate = findReanchorCandidate(
      fileLines,
      item.line_start,
      item.line_end,
      item.anchor.content_hash,
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
