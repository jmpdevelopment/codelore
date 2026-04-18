/**
 * Annotation categories describe properties of the code itself
 * (behavior, constraints, hazards) rather than workflow state.
 */
export const ANNOTATION_CATEGORIES = [
  'behavior',
  'rationale',
  'constraint',
  'gotcha',
  'business_rule',
  'performance',
  'security',
  'human_note',
] as const;

export type AnnotationCategory = (typeof ANNOTATION_CATEGORIES)[number];

export type AnnotationSource = 'ai_generated' | 'ai_verified' | 'human_authored';

const VALID_SOURCES: ReadonlySet<string> = new Set<AnnotationSource>([
  'ai_generated',
  'ai_verified',
  'human_authored',
]);

/** Coerces a parsed `source` to a valid enum value, defaulting to `human_authored`. */
export function coerceSource(raw: unknown): AnnotationSource {
  return typeof raw === 'string' && VALID_SOURCES.has(raw) ? (raw as AnnotationSource) : 'human_authored';
}

export interface ContentAnchor {
  content_hash: string;
  /** Hash of the function/class signature line for more stable anchoring. */
  signature_hash?: string;
  stale: boolean;
}

export interface FileDependency {
  /** Target file path (relative to workspace root). */
  file: string;
  /** Optional line range in the target file. */
  line_start?: number;
  line_end?: number;
  /** Describes the relationship (e.g., "must stay in sync", "calls this function"). */
  relationship: string;
}

export interface Annotation {
  id: string;
  file: string;
  line_start: number;
  line_end: number;
  category: AnnotationCategory;
  text: string;
  source: AnnotationSource;
  session_id?: string;
  commit_hash?: string;
  created_at: string;
  author?: string;
  /** Set when a human has read an AI-authored annotation and confirmed it is accurate. */
  verified_by?: string;
  /** ISO 8601 timestamp stamped alongside {@link verified_by}. */
  verified_at?: string;
  anchor?: ContentAnchor;
  /** Cross-file dependencies — other files/regions this code is coupled with. */
  dependencies?: FileDependency[];
  /** Component ids this annotation is scoped to. Empty/absent = file-level only. */
  components?: string[];
}

export const CATEGORY_META: Record<AnnotationCategory, { label: string; icon: string; color: string; description: string }> = {
  behavior: {
    label: 'Behavior',
    icon: '$(book)',
    color: '#3f51b5',
    description: 'What this code does — especially non-obvious behavior a reader would otherwise miss',
  },
  rationale: {
    label: 'Rationale',
    icon: '$(lightbulb)',
    color: '#ffc107',
    description: 'Why it was built this way — decisions, rejected alternatives, historical context',
  },
  constraint: {
    label: 'Constraint',
    icon: '$(symbol-rule)',
    color: '#607d8b',
    description: 'Invariant, precondition, or postcondition that must hold for correctness',
  },
  gotcha: {
    label: 'Gotcha',
    icon: '$(warning)',
    color: '#ff5722',
    description: 'Footgun, counterintuitive quirk, or known hazard — proceed with care',
  },
  business_rule: {
    label: 'Business Rule',
    icon: '$(law)',
    color: '#e91e63',
    description: 'Documents a business rule or domain constraint — do not change without stakeholder sign-off',
  },
  performance: {
    label: 'Performance',
    icon: '$(dashboard)',
    color: '#8bc34a',
    description: 'Hot path, complexity assumption, or benchmark-sensitive region',
  },
  security: {
    label: 'Security',
    icon: '$(lock)',
    color: '#b71c1c',
    description: 'Trust boundary, auth assumption, sanitization requirement',
  },
  human_note: {
    label: 'Human Note',
    icon: '$(comment-discussion)',
    color: '#757575',
    description: 'Free-form human commentary — observations, questions, reminders',
  },
};
