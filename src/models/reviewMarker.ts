export interface ReviewMarker {
  file: string;
  line_start: number;
  line_end: number;
  reviewer: string;
  reviewed_at: string;
  commit_hash?: string;
}

/**
 * Merge an incoming review marker into a list of existing markers for the same file,
 * combining overlapping ranges into a single marker.
 */
export function mergeReviewMarkers(existing: ReviewMarker[], incoming: ReviewMarker): ReviewMarker[] {
  const nonOverlapping = existing.filter(
    m => m.line_end < incoming.line_start || m.line_start > incoming.line_end,
  );
  const overlapping = existing.filter(
    m => !(m.line_end < incoming.line_start || m.line_start > incoming.line_end),
  );

  let merged = incoming;
  for (const o of overlapping) {
    merged = {
      ...merged,
      line_start: Math.min(merged.line_start, o.line_start),
      line_end: Math.max(merged.line_end, o.line_end),
    };
  }

  return [...nonOverlapping, merged];
}
