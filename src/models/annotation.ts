export const ANNOTATION_CATEGORIES = [
  'verified',
  'needs_review',
  'modified',
  'confused',
  'hallucination',
  'intent',
  'accepted',
  'business_rule',
  'ai_prompt',
] as const;

/** Categories excluded from PR export — ephemeral working notes */
export const EPHEMERAL_CATEGORIES: ReadonlySet<AnnotationCategory> = new Set(['ai_prompt']);

export type AnnotationCategory = (typeof ANNOTATION_CATEGORIES)[number];

export type AnnotationSource = 'manual' | 'ai_suggested' | 'ai_accepted';

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
  anchor?: ContentAnchor;
  /** Cross-file dependencies — other files/regions this code is coupled with. */
  dependencies?: FileDependency[];
}

export const CATEGORY_META: Record<AnnotationCategory, { label: string; icon: string; color: string; description: string }> = {
  verified: {
    label: 'Verified',
    icon: '$(check)',
    color: '#4caf50',
    description: 'I reviewed this change and it looks correct',
  },
  needs_review: {
    label: 'Needs Review',
    icon: '$(search)',
    color: '#ff9800',
    description: "I haven't fully verified this—reviewer should check",
  },
  modified: {
    label: 'Modified',
    icon: '$(edit)',
    color: '#2196f3',
    description: "I changed the AI's output manually",
  },
  confused: {
    label: "Don't Understand",
    icon: '$(question)',
    color: '#ffeb3b',
    description: "I don't understand why the AI did this",
  },
  hallucination: {
    label: 'Potential Hallucination',
    icon: '$(warning)',
    color: '#f44336',
    description: 'This may reference non-existent APIs, methods, or patterns',
  },
  intent: {
    label: 'Intent Note',
    icon: '$(comment)',
    color: '#9c27b0',
    description: 'Context about what I asked the AI to do here',
  },
  accepted: {
    label: 'Accepted As-Is',
    icon: '$(thumbsup)',
    color: '#9e9e9e',
    description: 'Reviewed, acceptable without changes',
  },
  business_rule: {
    label: 'Business Rule',
    icon: '$(law)',
    color: '#e91e63',
    description: 'Documents a business rule or domain constraint — don\'t change without stakeholder sign-off',
  },
  ai_prompt: {
    label: 'AI Prompt',
    icon: '$(robot)',
    color: '#00bcd4',
    description: 'Quick note for AI agent — ephemeral, excluded from export',
  },
};
