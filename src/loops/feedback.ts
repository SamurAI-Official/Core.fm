/**
 * The feedback ledger: what a listener said about something they heard, and what it moved.
 *
 * `ratings` answers "how good was this run, for this market" and is tied to a run. This answers
 * "did the listener want more of this or less of it", which is the question a dislike button asks -
 * and it is deliberately not tied to a run, because a dislike can arrive on a song that was never
 * part of a designed cycle (or generated straight from the Create tab).
 *
 * Every row stores the features it was attributed to, so the ledger can be re-read later to explain
 * a weight (or to assemble a training set once the soft-tuning loop exists) without re-deriving
 * anything from the song.
 */
import { pool, jsonParse } from '../db/index.js';
import { uuid } from '../lib/util.js';
import type { FeedbackFeatures, FeedbackVerdict } from '../scoring/feedback.js';

export interface FeedbackRecord {
  id: string;
  market: string | null;
  verdict: FeedbackVerdict;
  score: number | null;
  reasons: string[];
  features: FeedbackFeatures;
  source: string | null;
  createdAt: string;
}

export function insertFeedback(input: {
  market?: string;
  verdict: FeedbackVerdict;
  score?: number;
  reasons?: string[];
  features?: FeedbackFeatures;
  source?: string;
}): string {
  const id = uuid();
  pool.query(
    `INSERT INTO feedback (id, market, verdict, score, reasons, features, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.market ?? null,
      input.verdict,
      input.score ?? null,
      JSON.stringify(input.reasons ?? []),
      JSON.stringify(input.features ?? {}),
      input.source ?? 'api',
    ],
  );
  return id;
}

export function listFeedback(options: { market?: string; verdict?: FeedbackVerdict; limit?: number } = {}): FeedbackRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.market) {
    clauses.push('market = ?');
    params.push(options.market);
  }
  if (options.verdict) {
    clauses.push('verdict = ?');
    params.push(options.verdict);
  }
  params.push(options.limit ?? 50);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT * FROM feedback ${where} ORDER BY created_at DESC LIMIT ?`,
    params,
  );
  return rows.map((row) => ({
    id: String(row.id),
    market: row.market ? String(row.market) : null,
    verdict: String(row.verdict) as FeedbackVerdict,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    reasons: jsonParse<string[]>(row.reasons, []),
    features: jsonParse<FeedbackFeatures>(row.features, {}),
    source: row.source ? String(row.source) : null,
    createdAt: String(row.created_at),
  }));
}

export interface FeedbackSummary {
  total: number;
  likes: number;
  dislikes: number;
  byMarket: Array<{ market: string; likes: number; dislikes: number }>;
  /** Reason ids, most used first - what people are actually objecting to. */
  reasons: Array<{ reason: string; count: number }>;
  /** How many dislikes named no reason, i.e. moved every feature the song carried. */
  unattributed: number;
}

export function feedbackSummary(limit = 2000): FeedbackSummary {
  const { rows } = pool.query<Record<string, unknown>>(
    'SELECT market, verdict, reasons FROM feedback ORDER BY created_at DESC LIMIT ?',
    [limit],
  );
  const byMarket = new Map<string, { likes: number; dislikes: number }>();
  const reasons = new Map<string, number>();
  let likes = 0;
  let dislikes = 0;
  let unattributed = 0;

  for (const row of rows) {
    const market = row.market ? String(row.market) : '-';
    const verdict = String(row.verdict);
    const entry = byMarket.get(market) ?? { likes: 0, dislikes: 0 };
    if (verdict === 'dislike') {
      dislikes += 1;
      entry.dislikes += 1;
    } else {
      likes += 1;
      entry.likes += 1;
    }
    byMarket.set(market, entry);

    const named = jsonParse<string[]>(row.reasons, []);
    if (named.length === 0 && verdict === 'dislike') unattributed += 1;
    for (const reason of named) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  return {
    total: rows.length,
    likes,
    dislikes,
    byMarket: [...byMarket.entries()]
      .map(([market, counts]) => ({ market, ...counts }))
      .sort((a, b) => b.likes + b.dislikes - (a.likes + a.dislikes)),
    reasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    unattributed,
  };
}
