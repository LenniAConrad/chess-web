export type VariationMode = 'explore' | 'mainline';
export type MoveActor = 'user' | 'opponent';

export interface PuzzleRecord {
  id: number;
  public_id: string;
  title: string;
  start_fen: string;
  source: string;
  random_bucket: number;
  random_key: number;
  root_node_id: number | null;
}

export interface PuzzleNodeRecord {
  id: number;
  puzzle_id: number;
  parent_id: number | null;
  ply: number;
  san: string;
  uci: string;
  fen_after: string;
  is_mainline: boolean;
  sibling_order: number;
  actor: MoveActor;
}

export interface PuzzleSessionRecord {
  id: string;
  anon_session_id: string;
  puzzle_id: number;
  mode: VariationMode;
  node_id: number | null;
  branch_cursor: Record<string, unknown>;
  started_from_history: boolean;
  prefetched: boolean;
  solved: boolean;
  revealed: boolean;
  autoplay_used: boolean;
  wrong_move_count: number;
  hint_count: number;
  created_at: string;
  updated_at: string;
}

export interface PuzzleSessionHistoryRecord {
  session_id: string;
  puzzle_public_id: string;
  puzzle_title: string;
  created_at: string;
  solved: boolean;
  revealed: boolean;
  autoplay_used: boolean;
  wrong_move_count: number;
  hint_count: number;
}
