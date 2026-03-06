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
  solved: boolean;
  revealed: boolean;
}
