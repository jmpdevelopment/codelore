import { AnnotationSource } from './annotation';

/**
 * A Component is a named grouping of related files — a subsystem, feature area,
 * or logical module. Components are tag-first: the definition (description,
 * owners) is optional metadata layered on top of the file list.
 *
 * Stored per-component at `.codediary/components/<id>.yaml`, committed to git.
 * The reverse file→components index is derived at runtime (see DiaryStore).
 */
export interface Component {
  /** URL-safe slug; used as the YAML filename. */
  id: string;
  /** Display name (human-readable). */
  name: string;
  /** Optional longer description of what this component does. */
  description?: string;
  /** Optional owner handles / emails (team attribution). */
  owners?: string[];
  /** Workspace-relative file paths that belong to this component. */
  files: string[];
  /** Who or what created this component (mirrors Annotation.source). */
  source: AnnotationSource;
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** ISO 8601 last-updated timestamp; bumped on any mutation. */
  updated_at: string;
  /** Git user who authored or last modified the component. */
  author?: string;
}

/** Lowercase alphanumeric + hyphen, 1-64 chars. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Derives a filesystem-safe slug from a free-form component name.
 * Used when a human types a display name and we need a stable id.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'component';
}

export function isValidComponentId(id: unknown): id is string {
  return typeof id === 'string' && SLUG_RE.test(id);
}
