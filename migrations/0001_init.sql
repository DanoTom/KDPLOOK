-- KDPLOOK initial schema (Cloudflare D1 / SQLite)

-- Key/value application settings (JSON payloads).
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Parsed-response cache. We cache *parsed JSON*, never raw HTML, so rows stay small.
CREATE TABLE IF NOT EXISTS cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache (expires_at);

-- A saved niche analysis (keyword + marketplace + the scored snapshot).
CREATE TABLE IF NOT EXISTS niches (
  id          TEXT PRIMARY KEY,
  keyword     TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  category    TEXT,
  summary     TEXT NOT NULL,          -- JSON: NicheSummary
  items       TEXT NOT NULL,          -- JSON: BookRecord[]
  notes       TEXT NOT NULL DEFAULT '',
  starred     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_niches_created ON niches (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_niches_keyword ON niches (marketplace, keyword);

-- Books tracked over time.
CREATE TABLE IF NOT EXISTS watchlist (
  asin        TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL DEFAULT '',
  format      TEXT NOT NULL DEFAULT '',
  image       TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (asin, marketplace)
);

-- Daily snapshots written by the cron trigger (and by manual refreshes).
CREATE TABLE IF NOT EXISTS rank_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  asin         TEXT NOT NULL,
  marketplace  TEXT NOT NULL,
  captured_at  INTEGER NOT NULL,
  bsr          INTEGER,
  price        REAL,
  rating       REAL,
  reviews      INTEGER,
  sales_est    REAL,
  revenue_est  REAL,
  category_ranks TEXT                 -- JSON: {name, rank}[]
);
CREATE INDEX IF NOT EXISTS idx_rank_asin ON rank_history (asin, marketplace, captured_at DESC);

-- Saved keyword research runs.
CREATE TABLE IF NOT EXISTS keyword_lists (
  id          TEXT PRIMARY KEY,
  seed        TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  keywords    TEXT NOT NULL,          -- JSON: KeywordRecord[]
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keyword_lists_created ON keyword_lists (created_at DESC);

-- Lightweight request log: how each upstream fetch went. Powers the Diagnostics panel.
CREATE TABLE IF NOT EXISTS fetch_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  kind       TEXT NOT NULL,           -- search | product | suggest
  target     TEXT NOT NULL,
  provider   TEXT NOT NULL,           -- direct | scraperapi | scrapingbee | custom
  status     INTEGER NOT NULL,
  ok         INTEGER NOT NULL,
  blocked    INTEGER NOT NULL DEFAULT 0,
  ms         INTEGER NOT NULL DEFAULT 0,
  parsed     INTEGER NOT NULL DEFAULT 0,
  detail     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_fetch_log_ts ON fetch_log (ts DESC);
