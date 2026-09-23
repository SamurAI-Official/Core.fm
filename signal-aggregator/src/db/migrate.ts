/**
 * Schema for the trend -> design -> generate -> score -> repeat loop.
 * Idempotent: safe to run on every process start.
 */
import { exec, pool } from './index.js';
import { config } from '../config.js';
import { MARKET_CATALOG, marketInfo } from '../markets.js';
import { trackKey } from '../lib/util.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS markets (
  cc TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  secondary_languages TEXT,
  region TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (market, source) collection pass. Lets us diff snapshots to
-- measure momentum (what is rising vs. what is merely popular).
CREATE TABLE IF NOT EXISTS signal_snapshots (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  track_count INTEGER NOT NULL DEFAULT 0,
  payload_hash TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  market TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  rank INTEGER,
  title TEXT NOT NULL,
  artist TEXT,
  external_id TEXT,
  url TEXT,
  genres TEXT,
  canonical_genres TEXT,
  duration_ms INTEGER,
  release_date TEXT,
  bpm REAL,
  -- Normalized artist::title identity. Drives per-track rank time series so a
  -- track can be followed across collection runs (and across sources).
  track_key TEXT,
  enriched INTEGER NOT NULL DEFAULT 0,
  raw TEXT
);

CREATE INDEX IF NOT EXISTS idx_signals_market_source ON signals (market, source, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_snapshot ON signals (snapshot_id);

-- Derived, explainable market profile: genre/BPM/key/language distributions
-- plus momentum and lyrical themes, used to drive song design.
CREATE TABLE IF NOT EXISTS market_briefs (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  track_count INTEGER NOT NULL DEFAULT 0,
  genre_weights TEXT,
  momentum TEXT,
  bpm_median REAL,
  bpm_p25 REAL,
  bpm_p75 REAL,
  tempo_class TEXT,
  key_weights TEXT,
  duration_median REAL,
  languages TEXT,
  top_artists TEXT,
  top_terms TEXT,
  summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_briefs_market ON market_briefs (market, created_at DESC);

-- A song design (style prompt + lyrics + generation params) for one market.
CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL,
  brief_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'designed',
  title TEXT NOT NULL,
  style TEXT NOT NULL,
  lyrics TEXT,
  instrumental INTEGER NOT NULL DEFAULT 0,
  vocal_language TEXT,
  bpm INTEGER,
  key_scale TEXT,
  time_signature TEXT,
  duration INTEGER,
  batch_size INTEGER NOT NULL DEFAULT 1,
  thinking INTEGER NOT NULL DEFAULT 1,
  enhance INTEGER NOT NULL DEFAULT 1,
  primary_genre TEXT,
  seed INTEGER,
  rationale TEXT,
  params TEXT
);

CREATE INDEX IF NOT EXISTS idx_concepts_market ON concepts (market, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_concepts_status ON concepts (status);

-- One generated artifact per (concept, iteration) plus its scores.
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  concept_id TEXT,
  market TEXT NOT NULL,
  iteration INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  pipeline_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  audio_urls TEXT,
  duration REAL,
  reported_bpm REAL,
  reported_key TEXT,
  time_signature TEXT,
  market_fit REAL,
  novelty REAL,
  engine_score REAL,
  human_score REAL,
  composite REAL,
  verdict TEXT,
  breakdown TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_market ON runs (market, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_concept ON runs (concept_id);

-- Human/panel ratings: the actual market test step. Feeds the learning loop.
CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  market TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  score REAL NOT NULL,
  notes TEXT,
  rater TEXT
);

-- Explicit preference over something a listener actually heard: the dislike button. A rating is a
-- score attached to a *run*; this is a judgement on any output, with optional reasons that
-- attribute the blame to a part of the song ("muddy mix", "bad lyrics", "wrong genre"). Kept
-- separate from the ratings table so the two never overwrite each other, and so feedback on a song
-- that never came from a designed run is still learnable.
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  market TEXT,
  verdict TEXT NOT NULL,
  score REAL,
  reasons TEXT,
  features TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (verdict, weight key) the verdict blamed, attributed to the person who judged.
--
-- Votes exist so agreement can be counted before a market's weights move: three listeners disliking
-- tag:country is a pattern, one listener disliking it three times is not, and market_weights alone
-- cannot tell the two apart. Promotions read these rows; promoted_at marks the votes that have
-- already been acted on, so a later promotion counts only the votes that arrived since.
CREATE TABLE IF NOT EXISTS feedback_votes (
  feedback_id TEXT NOT NULL,
  market TEXT NOT NULL,
  key TEXT NOT NULL,
  -- +1 for a like, -1 for a dislike.
  sign INTEGER NOT NULL,
  rater TEXT,
  -- The weight delta this vote asked for, so a promotion can be applied and explained.
  delta REAL NOT NULL,
  promoted_at TEXT,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A listener's own profile, keyed by an opaque rater id. Same key grammar as market_weights so the
-- two can be compared (and blended) directly, but written immediately on every verdict: the market
-- has to wait for agreement, the individual does not. Theme, tag and the lyric-side keys all live
-- here too, so a hard no on "the words" is remembered as a preference about subjects and writing
-- styles rather than as a complaint nobody can act on.
CREATE TABLE IF NOT EXISTS user_weights (
  rater TEXT NOT NULL,
  key TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (rater, key)
);

-- Model editions: the soft-tuning loop's spine.
--
-- An edition is a LoRA tuned from the previous one (consecutive, never from scratch) on a *corpus*
-- drawn from the preference ledger plus anchors that must stay in the mix. The row records exactly what
-- it was trained on (dataset_hash, dataset_manifest) and what it was judged by (evaluation), so "which
-- model made this song, trained on what, and why was it adopted" is answerable months later.
--
-- The ordinal is what a song records as its provenance (0 = the base model, 1.. = tuned). Exactly one
-- edition may be adopted at a time - enforced by the partial unique index below rather than by
-- convention, because two adopted editions would make "the incumbent" ambiguous and an ambiguous
-- incumbent is how an uncontrolled loop makes its decisions.
CREATE TABLE IF NOT EXISTS editions (
  id TEXT PRIMARY KEY,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL,
  base_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  adopted_at TEXT,
  retired_at TEXT,
  dataset_hash TEXT,
  dataset_manifest TEXT,
  dataset_path TEXT,
  hyperparameters TEXT,
  adapter_path TEXT,
  feedback_window TEXT,
  evaluation TEXT,
  notes TEXT
);

-- Adaptive per-market weights updated after every scored cycle
-- (things that scored well get sampled more often next cycle).
CREATE TABLE IF NOT EXISTS market_weights (
  market TEXT NOT NULL,
  key TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (market, key)
);

CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  markets TEXT,
  concepts_created INTEGER NOT NULL DEFAULT 0,
  generated INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

-- Small key/value store (pipeline token cache, last collect marker, etc.)
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/** Adds a column when upgrading an existing database file. */
function ensureColumn(table: string, column: string, definition: string): void {
  const { rows } = pool.query<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!rows.some((row) => row.name === column)) {
    pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Fills `track_key` for rows written before the column existed.
 *
 * Must run in JS rather than SQL: the normalization (NFKD folding, Unicode-aware
 * token stripping) mirrors `trackKey()` used at insert time, and a SQL
 * approximation would produce keys that never match new rows - silently
 * splitting every existing track's history in two.
 */
function backfillTrackKeys(): void {
  const { rows } = pool.query<{ id: string; title: string; artist: string | null }>(
    `SELECT id, title, artist FROM signals WHERE track_key IS NULL LIMIT 20000`,
  );
  if (rows.length === 0) return;
  for (const row of rows) {
    pool.query('UPDATE signals SET track_key = ? WHERE id = ?', [trackKey(row.title, row.artist), row.id]);
  }
  console.log(`[migrate] backfilled track_key for ${rows.length} signal row(s)`);
}

export function runMigrations(): void {
  exec(SCHEMA);
  ensureColumn('signals', 'bpm', 'REAL');
  ensureColumn('runs', 'local_audio', 'TEXT');
  ensureColumn('runs', 'stage', 'TEXT');
  ensureColumn('signals', 'track_key', 'TEXT');
// Recurring title phrases for the lyric writer, mined from each brief's own sample. Older briefs
// have no value and fall back to the static regional table.
ensureColumn('market_briefs', 'themes', 'TEXT');
// A run rating may carry an explicit dislike, which learns differently from a low score.
ensureColumn('ratings', 'verdict', 'TEXT');
// Who judged (an opaque id), and which response they judged. Both are needed to count agreement
// between *distinct* listeners, and to let a retracted verdict find its own votes again.
ensureColumn('feedback', 'rater', 'TEXT');
ensureColumn('feedback', 'source_id', 'TEXT');
ensureColumn('feedback', 'withdrawn', 'INTEGER NOT NULL DEFAULT 0');
// Decay's own clock. Kept apart from updated_at so "when was this weight last learned" stays a
// readable fact rather than being rewritten by every decay pass.
ensureColumn('market_weights', 'decayed_at', 'TEXT');
ensureColumn('user_weights', 'decayed_at', 'TEXT');
// Which model edition produced the response being judged, and which prompt it answered. The edition is
// what makes feedback on edition N the training signal for N+1; the prompt is what lets the corpus hold
// out whole prompts rather than single responses.
ensureColumn('feedback', 'edition', 'TEXT');
ensureColumn('feedback', 'prompt_id', 'TEXT');
  backfillTrackKeys();
  exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_editions_one_adopted ON editions (status) WHERE status = 'adopted';
    CREATE INDEX IF NOT EXISTS idx_editions_ordinal ON editions (ordinal);
    CREATE INDEX IF NOT EXISTS idx_signals_track_series ON signals (market, track_key, captured_at);
    CREATE INDEX IF NOT EXISTS idx_signals_market_time ON signals (market, captured_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_votes_pending
      ON feedback_votes (market, key, sign, promoted_at, withdrawn_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_votes_source ON feedback_votes (feedback_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_rater ON feedback (market, rater);
  `);

  const statement = `
    INSERT INTO markets (cc, name, language, secondary_languages, region, active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(cc) DO UPDATE SET
      name = excluded.name,
      language = excluded.language,
      secondary_languages = excluded.secondary_languages,
      region = excluded.region,
      active = excluded.active,
      updated_at = datetime('now')
  `;

  const active = new Set(config.markets);
  for (const cc of Object.keys(MARKET_CATALOG)) {
    const info = marketInfo(cc);
    pool.query(statement, [
      cc,
      info.name,
      info.language,
      JSON.stringify(info.secondaryLanguages ?? []),
      info.region,
      active.has(cc) ? 1 : 0,
    ]);
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('db/migrate.ts')) {
  runMigrations();
  console.log(`Migrations complete: ${config.dbPath}`);
}