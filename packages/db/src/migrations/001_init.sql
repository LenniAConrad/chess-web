CREATE TABLE IF NOT EXISTS schema_migrations (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS puzzles (
  id bigserial PRIMARY KEY,
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  start_fen text NOT NULL,
  source text NOT NULL DEFAULT '',
  random_bucket int NOT NULL,
  random_key double precision NOT NULL,
  root_node_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS puzzle_nodes (
  id bigserial PRIMARY KEY,
  puzzle_id bigint NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  parent_id bigint REFERENCES puzzle_nodes(id) ON DELETE CASCADE,
  ply int NOT NULL,
  san text NOT NULL DEFAULT '',
  uci text NOT NULL DEFAULT '',
  fen_after text NOT NULL,
  is_mainline boolean NOT NULL DEFAULT false,
  sibling_order int NOT NULL DEFAULT 0,
  actor text NOT NULL CHECK (actor IN ('user', 'opponent')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE puzzles
  ADD CONSTRAINT puzzles_root_node_fk
  FOREIGN KEY (root_node_id) REFERENCES puzzle_nodes(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS puzzle_import_jobs (
  id bigserial PRIMARY KEY,
  source_file text NOT NULL,
  total int NOT NULL DEFAULT 0,
  success int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS anon_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ua_hash text NOT NULL,
  ip_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS puzzle_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_session_id uuid NOT NULL REFERENCES anon_sessions(id) ON DELETE CASCADE,
  puzzle_id bigint NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('explore', 'mainline')),
  node_id bigint REFERENCES puzzle_nodes(id) ON DELETE SET NULL,
  branch_cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  solved boolean NOT NULL DEFAULT false,
  revealed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limit_events (
  id bigserial PRIMARY KEY,
  ip_hash text NOT NULL,
  anon_session_id uuid REFERENCES anon_sessions(id) ON DELETE SET NULL,
  route text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL CHECK (action IN ('allow', 'throttle', 'ban'))
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  day date PRIMARY KEY,
  dau int NOT NULL DEFAULT 0,
  puzzles_started int NOT NULL DEFAULT 0,
  puzzles_solved int NOT NULL DEFAULT 0,
  avg_session_seconds int NOT NULL DEFAULT 0,
  hint_used int NOT NULL DEFAULT 0,
  reveal_used int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS puzzles_random_idx ON puzzles (random_bucket, random_key);
CREATE INDEX IF NOT EXISTS puzzle_nodes_puzzle_parent_idx ON puzzle_nodes (puzzle_id, parent_id, sibling_order);
CREATE INDEX IF NOT EXISTS puzzle_nodes_actor_idx ON puzzle_nodes (puzzle_id, actor);
CREATE INDEX IF NOT EXISTS puzzle_sessions_anon_idx ON puzzle_sessions (anon_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rate_limit_events_idx ON rate_limit_events (ip_hash, route, ts DESC);
