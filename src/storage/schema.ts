/**
 * Current on-disk schema version for CodeDiary YAML files. Bumped from
 * implicit v1 (no `version:` field) to v2 alongside the knowledge-store pivot.
 * Writes always emit this version; reads accept missing (legacy v1) and v2.
 */
export const SCHEMA_VERSION = 2;

export function detectVersion(data: unknown): number {
  if (!data || typeof data !== 'object') { return 1; }
  const version = (data as { version?: unknown }).version;
  return typeof version === 'number' ? version : 1;
}
