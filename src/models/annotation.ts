export const ANNOTATION_CATEGORIES = [
  'verified',
  'needs_review',
  'modified',
  'confused',
  'hallucination',
  'intent',
  'accepted',
  'ai_prompt',
] as const;

/** Categories excluded from PR export — ephemeral working notes */
export const EPHEMERAL_CATEGORIES: ReadonlySet<AnnotationCategory> = new Set(['ai_prompt']);

export type AnnotationCategory = (typeof ANNOTATION_CATEGORIES)[number];

export type AnnotationSource = 'manual' | 'ai_suggested' | 'ai_accepted';

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
  ai_prompt: {
    label: 'AI Prompt',
    icon: '$(robot)',
    color: '#00bcd4',
    description: 'Quick note for AI agent — ephemeral, excluded from export',
  },
};
