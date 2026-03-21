import { ContentAnchor } from './annotation';

export type CriticalSeverity = 'critical' | 'high' | 'medium';

export interface CriticalFlag {
  file: string;
  line_start: number;
  line_end: number;
  severity: CriticalSeverity;
  description?: string;
  human_reviewed: boolean;
  resolved_by?: string;
  resolved_at?: string;
  resolution_comment?: string;
  anchor?: ContentAnchor;
}
