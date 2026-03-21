export interface ReviewMarker {
  file: string;
  line_start: number;
  line_end: number;
  reviewer: string;
  reviewed_at: string;
  commit_hash?: string;
}
