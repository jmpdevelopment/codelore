/**
 * Knowledge-first categories introduced by the 2026-04-18 pivot. These describe
 * properties of the code itself (behavior, constraints, hazards) rather than
 * workflow state (reviewed, accepted). Surfaced in new annotation pickers.
 */
export const KNOWLEDGE_CATEGORIES = [
  'behavior',
  'rationale',
  'constraint',
  'gotcha',
  'business_rule',
  'performance',
  'security',
  'human_note',
] as const;

/**
 * Pre-pivot review-workflow categories. Kept in the type + metadata so legacy
 * YAML still renders, but filtered out of new-annotation flows (see commit 1.7).
 * Migration in commit 1.6 rewrites them into {@link KNOWLEDGE_CATEGORIES}.
 */
export const LEGACY_CATEGORIES = [
  'verified',
  'needs_review',
  'modified',
  'confused',
  'hallucination',
  'intent',
  'accepted',
] as const;

export const ANNOTATION_CATEGORIES = [
  ...KNOWLEDGE_CATEGORIES,
  ...LEGACY_CATEGORIES,
  'ai_prompt',
] as const;

/** Categories excluded from PR export — ephemeral working notes */
export const EPHEMERAL_CATEGORIES: ReadonlySet<AnnotationCategory> = new Set(['ai_prompt']);

export type AnnotationCategory = (typeof ANNOTATION_CATEGORIES)[number];

export type AnnotationSource = 'ai_generated' | 'ai_verified' | 'human_authored';

/** Legacy pre-pivot values; normalized to {@link AnnotationSource} at the store boundary. */
export type LegacyAnnotationSource = 'manual' | 'ai_suggested' | 'ai_accepted';

const LEGACY_SOURCE_MAP: Record<LegacyAnnotationSource, AnnotationSource> = {
  manual: 'human_authored',
  ai_suggested: 'ai_generated',
  ai_accepted: 'ai_verified',
};

/**
 * Coerces a raw `source` value from disk into the current enum. Unknown values
 * fall back to `human_authored` so a corrupt or partially-migrated file never
 * surfaces an `undefined` source downstream.
 */
export function normalizeSource(raw: unknown): AnnotationSource {
  if (typeof raw !== 'string') { return 'human_authored'; }
  if (raw in LEGACY_SOURCE_MAP) { return LEGACY_SOURCE_MAP[raw as LegacyAnnotationSource]; }
  if (raw === 'ai_generated' || raw === 'ai_verified' || raw === 'human_authored') { return raw; }
  return 'human_authored';
}

/** Normalizes source + reserved verification fields when loading from YAML. */
export function normalizeAnnotation<T extends { source?: unknown }>(raw: T): T & { source: AnnotationSource } {
  return { ...raw, source: normalizeSource(raw.source) };
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
  ai_prompt: {
    label: 'AI Prompt',
    icon: '$(robot)',
    color: '#00bcd4',
    description: 'Quick note for AI agent — ephemeral, excluded from export',
  },
  verified: {
    label: 'Verified',
    icon: '$(check)',
    color: '#4caf50',
    description: 'Legacy — review-workflow category; migrated to human_note or rationale',
  },
  needs_review: {
    label: 'Needs Review',
    icon: '$(search)',
    color: '#ff9800',
    description: 'Legacy — review-workflow category; migrated to human_note',
  },
  modified: {
    label: 'Modified',
    icon: '$(edit)',
    color: '#2196f3',
    description: 'Legacy — review-workflow category; migrated to human_note',
  },
  confused: {
    label: "Don't Understand",
    icon: '$(question)',
    color: '#ffeb3b',
    description: 'Legacy — review-workflow category; migrated to human_note',
  },
  hallucination: {
    label: 'Potential Hallucination',
    icon: '$(warning)',
    color: '#f44336',
    description: 'Legacy — review-workflow category; migrated to gotcha',
  },
  intent: {
    label: 'Intent Note',
    icon: '$(comment)',
    color: '#9c27b0',
    description: 'Legacy — review-workflow category; migrated to rationale or human_note',
  },
  accepted: {
    label: 'Accepted As-Is',
    icon: '$(thumbsup)',
    color: '#9e9e9e',
    description: 'Legacy — review-workflow category; migrated to human_note',
  },
};
