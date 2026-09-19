/**
 * Human ratings (the market test step) and the adaptive per-market weights that
 * close the loop: what scored well gets sampled more often next cycle.
 */
import { pool } from '../db/index.js';
import { uuid } from '../lib/util.js';
import type { MarketWeight } from '../design/types.js';
import { mapRun, type RunRecord } from './store.js';

export function insertRating(input: {
  runId: string;
  market: string;
  score: number;
  notes?: string;
  rater?: string;
}): string {
  const id = uuid();
  pool.query(
    'INSERT INTO ratings (id, run_id, market, score, notes, rater) VALUES (?, ?, ?, ?, ?, ?)',
    [id, input.runId, input.market, input.score, input.notes ?? null, input.rater ?? 'local'],
  );
  return id;
}

/** Mean human rating for one run (0..1), or null when unrated. */
export function humanScore(runId: string): number | null {
  const { rows } = pool.query<{ score: number; n: number }>(
    'SELECT AVG(score) AS score, COUNT(*) AS n FROM ratings WHERE run_id = ?',
    [runId],
  );
  const row = rows[0];
  if (!row || !Number(row.n)) return null;
  return Number(row.score);
}

/** Succeeded runs that still need a human rating - the market test queue. */
export function unratedRuns(market?: string, limit = 50): RunRecord[] {
  const params: unknown[] = [];
  let where = "WHERE r.status IN ('succeeded', 'scored')";
  if (market) {
    where += ' AND r.market = ?';
    params.push(market);
  }
  params.push(limit);
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT r.* FROM runs r
     LEFT JOIN ratings rt ON rt.run_id = r.id
     ${where} AND rt.id IS NULL
     ORDER BY r.started_at DESC LIMIT ?`,
    params,
  );
  return rows.map(mapRun);
}

/** Ratings recorded for a market, newest first. */
export function listRatings(market: string, limit = 50): Array<{ runId: string; score: number; notes: string | null; createdAt: string }> {
  const { rows } = pool.query<{ run_id: string; score: number; notes: string | null; created_at: string }>(
    'SELECT run_id, score, notes, created_at FROM ratings WHERE market = ? ORDER BY created_at DESC LIMIT ?',
    [market, limit],
  );
  return rows.map((row) => ({
    runId: String(row.run_id),
    score: Number(row.score),
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at),
  }));
}

// ---------------------------------------------------------------------------
// Adaptive market weights
// ---------------------------------------------------------------------------

export function getWeights(market: string): MarketWeight[] {
  const { rows } = pool.query<{ key: string; value: number }>(
    'SELECT key, value FROM market_weights WHERE market = ? ORDER BY value DESC',
    [market],
  );
  return rows.map((row) => ({ key: row.key, value: Number(row.value) }));
}

export function getWeightsForMarkets(markets: string[]): Record<string, MarketWeight[]> {
  const out: Record<string, MarketWeight[]> = {};
  for (const market of markets) out[market] = getWeights(market);
  return out;
}

export function setWeight(market: string, key: string, value: number): void {
  pool.query(
    `INSERT INTO market_weights (market, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(market, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [market, key, value],
  );
}

export function getWeight(market: string, key: string, fallback = 1): number {
  const { rows } = pool.query<{ value: number }>(
    'SELECT value FROM market_weights WHERE market = ? AND key = ?',
    [market, key],
  );
  return rows[0] ? Number(rows[0].value) : fallback;
}

/** Short human-readable summary of what a market has learned so far. */
export function weightNotes(market: string, limit = 4): string[] {
  return getWeights(market)
    .filter((weight) => Math.abs(weight.value - 1) > 0.15)
    .slice(0, limit)
    .map((weight) => `${weight.key} x${weight.value.toFixed(2)}`);
}