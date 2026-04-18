/**
 * Current on-disk schema version for CodeDiary YAML files. v1 (no `version:`
 * field) was the pre-pivot review-workflow schema; v2 is the knowledge-store
 * schema introduced 2026-04-18 and is the only version this release supports.
 */
export const SCHEMA_VERSION = 2;

/**
 * Throws if a parsed YAML document is on an unsupported schema version. v1
 * files (or anything without an explicit `version: 2` marker) are rejected
 * outright — there is no migration path in this release.
 */
export function assertSupportedVersion(data: unknown, sourceLabel: string): void {
  if (!data || typeof data !== 'object') { return; }
  const version = (data as { version?: unknown }).version;
  if (version === SCHEMA_VERSION) { return; }
  if (version === undefined || version === 1) {
    throw new Error(
      `CodeDiary v1 schema is not supported (file: ${sourceLabel}); this release requires v2.`,
    );
  }
  throw new Error(
    `CodeDiary: unknown schema version ${String(version)} in ${sourceLabel} (expected ${SCHEMA_VERSION}).`,
  );
}
