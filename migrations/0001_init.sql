-- Jevboard schema. Timestamps are epoch milliseconds; JSON arrays/objects are TEXT.
-- Applied with `wrangler d1 migrations apply DB` (and loaded verbatim by the Node test harness).

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  site_key TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  name TEXT NOT NULL,
  tldr TEXT NOT NULL,
  verdict TEXT NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  subscores TEXT NOT NULL,
  score INTEGER NOT NULL,
  tie_rank INTEGER NOT NULL DEFAULT 0,
  judgment_id TEXT NOT NULL,
  rolls INTEGER NOT NULL DEFAULT 1,
  best_score INTEGER NOT NULL,
  worst_score INTEGER NOT NULL,
  last_delta INTEGER NOT NULL DEFAULT 0,
  manipulation_attempt INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  content_flag TEXT NOT NULL DEFAULT 'none',
  og_image TEXT,
  entry_number INTEGER NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  first_judged_at INTEGER NOT NULL,
  last_judged_at INTEGER NOT NULL
);
CREATE INDEX entries_rank_idx ON entries (hidden, score DESC, tie_rank ASC);
CREATE INDEX entries_recent_idx ON entries (last_judged_at DESC);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  site_key TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  stage_detail TEXT,
  error TEXT,
  amount_cents INTEGER NOT NULL,
  entry_id TEXT,
  judgment_id TEXT,
  -- Jev's verdict is persisted between the judgment and placement queue stages.
  verdict_json TEXT,
  model TEXT,
  pages_crawled TEXT,
  og_image TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX orders_status_idx ON orders (status, updated_at);
CREATE INDEX orders_site_idx ON orders (site_key);
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);

CREATE TABLE judgments (
  id TEXT PRIMARY KEY,
  serial INTEGER NOT NULL UNIQUE,
  entry_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  roll INTEGER NOT NULL,
  score INTEGER NOT NULL,
  previous_score INTEGER,
  rank_at_placement INTEGER NOT NULL,
  name TEXT NOT NULL,
  tldr TEXT NOT NULL,
  verdict TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  subscores TEXT NOT NULL,
  strengths TEXT NOT NULL,
  weaknesses TEXT NOT NULL,
  receipts TEXT NOT NULL,
  manipulation_attempt INTEGER NOT NULL DEFAULT 0,
  content_flag TEXT NOT NULL DEFAULT 'none',
  pages_crawled TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX judgments_entry_idx ON judgments (entry_id, roll);
CREATE INDEX judgments_created_idx ON judgments (created_at);

CREATE TABLE duels (
  id TEXT PRIMARY KEY,
  judgment_id TEXT NOT NULL,
  challenger_id TEXT NOT NULL,
  opponent_id TEXT NOT NULL,
  winner_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  score INTEGER NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX duels_judgment_idx ON duels (judgment_id, seq);
CREATE INDEX duels_challenger_idx ON duels (challenger_id);
CREATE INDEX duels_opponent_idx ON duels (opponent_id);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  entry_id TEXT,
  site_key TEXT,
  other_site_key TEXT,
  score INTEGER,
  rank INTEGER,
  delta INTEGER,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE reigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX reigns_entry_idx ON reigns (entry_id, ended_at);

CREATE TABLE visitors (
  id TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL
);

-- "N watching": heartbeats, pruned by the cron trigger.
CREATE TABLE presence (
  visitor_id TEXT PRIMARY KEY,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX presence_seen_idx ON presence (last_seen_at);

-- Local checkout simulator (only used without AUTUMN_SECRET_KEY).
CREATE TABLE fake_payments (
  order_id TEXT PRIMARY KEY,
  paid_at INTEGER NOT NULL
);
