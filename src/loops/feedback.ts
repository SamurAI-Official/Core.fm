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
import { config } from '../config.js';
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
  /** Opaque id of whoever judged, or null for feedback that arrived without one. */
  rater: string | null;
  /** Which response was judged (song id), so a retracted verdict can find its own votes. */
  sourceId: string | null;
  /** True once the row has been retracted; it stays in the ledger but stops counting. */
  withdrawn: boolean;
  createdAt: string;
}

export function insertFeedback(input: {
  market?: string;
  verdict: FeedbackVerdict;
  score?: number;
  reasons?: string[];
  features?: FeedbackFeatures;
  source?: string;
  rater?: string;
  sourceId?: string;
  /** The model edition that produced the judged response; the soft-tuning loop's provenance. */
  edition?: string;
  /** The prompt it answered, so a corpus can hold out whole prompts rather than single responses. */
  promptId?: string;
}): string {
  const id = uuid();
  pool.query(
    `INSERT INTO feedback (id, market, verdict, score, reasons, features, source, rater, source_id, edition, prompt_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.market ?? null,
      input.verdict,
      input.score ?? null,
      JSON.stringify(input.reasons ?? []),
      JSON.stringify(input.features ?? {}),
      input.source ?? 'api',
      input.rater ?? null,
      input.sourceId ?? null,
      input.edition ?? null,
      input.promptId ?? null,
    ],
  );
  return id;
}

/**
 * Records what a verdict blamed, one row per weight key.
 *
 * A vote is a promise, not a decision: it says "this listener asked for more/less of this key". The
 * weights only move when `promoteFeedback` finds enough distinct raters agreeing, which is why the
 * deltas are stored rather than applied here - so the promotion can be applied later, exactly, and
 * explained afterwards.
 */
export function insertVotes(input: {
  feedbackId: string;
  market: string;
  /** +1 for "more of this", -1 for "less of it". */
  sign: number;
  rater?: string;
  steps: Array<{ key: string; delta: number }>;
}): number {
  let written = 0;
  for (const step of input.steps) {
    if (step.delta === 0) continue;
    pool.query(
      `INSERT INTO feedback_votes (feedback_id, market, key, sign, rater, delta)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.feedbackId, input.market, step.key, input.sign, input.rater ?? null, step.delta],
    );
    written += 1;
  }
  return written;
}

/** Votes a verdict produced, newest first - the evidence behind a weight. */
export function listVotesFor(feedbackId: string): Array<{ key: string; sign: number; delta: number; promotedAt: string | null; withdrawnAt: string | null }> {
  const { rows } = pool.query<Record<string, unknown>>(
    'SELECT key, sign, delta, promoted_at, withdrawn_at FROM feedback_votes WHERE feedback_id = ?',
    [feedbackId],
  );
  return rows.map((row) => ({
    key: String(row.key),
    sign: Number(row.sign),
    delta: Number(row.delta),
    promotedAt: row.promoted_at ? String(row.promoted_at) : null,
    withdrawnAt: row.withdrawn_at ? String(row.withdrawn_at) : null,
  }));
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
    rater: row.rater ? String(row.rater) : null,
    sourceId: row.source_id ? String(row.source_id) : null,
    withdrawn: Number(row.withdrawn ?? 0) === 1,
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
  /** Distinct people who have judged anything; the number a promotion threshold is measured against. */
  raters: number;
  /** Verdicts taken back by the person who gave them. */
  withdrawn: number;
  /** Verdicts whose votes have moved a market's weights. */
  promoted: number;
  /** Votes still waiting for enough distinct listeners to agree. */
  pending: number;
}

/**
 * How many verdicts one listener may act with in a day.
 *
 * The agreement gate stops one person moving a *market*, but agreement is counted in people while
 * magnitude is counted in votes (17.10), so a flood of judgements from one listener still adds
 * unbounded magnitude once others agree - and it drives that listener's own profile to the floor on its
 * own. A hard-no button is also a way to grief, so the ingress is capped.
 *
 * Two deliberate details:
 *
 *   - the cap counts verdicts *sent*, not verdicts standing: taking one back does not buy another, so a
 *     flood cannot be laundered through retraction;
 *   - retractions themselves are never capped. Refusing to let someone withdraw a judgement they made
 *     would be indefensible, and a withdrawal can only reverse what that listener did.
 *
 * A verdict that arrives after the cap is still *recorded* - it is a fact about what someone heard, and
 * the ledger is where facts live - but it is planned as nothing, so neither the market's votes nor the
 * listener's own profile move. `limit: 0` means unlimited.
 */
export interface RateLimitStatus {
  /** The cap in force. 0 means unlimited. */
  limit: number;
  /** Verdicts this rater has sent in the window that could have acted. */
  used: number;
  windowHours: number;
  allowed: boolean;
  /** When the window frees up a slot, if it ever does. */
  resetsAt: string | null;
}

export function verdictRateLimit(
  rater: string,
  options: { limit?: number; windowHours?: number } = {},
): RateLimitStatus {
  const limit = options.limit ?? config.feedback.maxVerdictsPerDay;
  const windowHours = options.windowHours ?? config.feedback.rateLimitWindowHours;
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM feedback
     WHERE rater = ? AND verdict <> 'none' AND created_at >= datetime('now', ?)`,
    [rater, `-${Math.max(1, Math.round(windowHours))} hours`],
  );
  const used = Number(rows[0]?.n ?? 0);
  const oldest = rows[0]?.oldest ? String(rows[0].oldest) : null;
  const resetsAt =
    oldest && limit > 0
      ? new Date(new Date(`${oldest.replace(' ', 'T')}Z`).getTime() + windowHours * 3600 * 1000)
          .toISOString()
          .replace('T', ' ')
          .slice(0, 19)
      : null;
  return {
    limit,
    used,
    windowHours,
    allowed: limit <= 0 || used < limit,
    resetsAt,
  };
}

/** Marks a verdict as retracted. It stays in the ledger; its votes are dealt with by the promotion layer. */
export function markWithdrawn(feedbackId: string): void {
  pool.query('UPDATE feedback SET withdrawn = 1 WHERE id = ?', [feedbackId]);
}

/** The most recent non-withdrawn verdict this person gave on this response, if any. */
export function findFeedbackBySource(options: {
  market: string;
  rater: string;
  sourceId: string;
}): FeedbackRecord | null {
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT * FROM feedback
     WHERE market = ? AND rater = ? AND source_id = ? AND withdrawn = 0
     ORDER BY created_at DESC LIMIT 1`,
    [options.market, options.rater, options.sourceId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    market: row.market ? String(row.market) : null,
    verdict: String(row.verdict) as FeedbackVerdict,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    reasons: jsonParse<string[]>(row.reasons, []),
    features: jsonParse<FeedbackFeatures>(row.features, {}),
    source: row.source ? String(row.source) : null,
    rater: row.rater ? String(row.rater) : null,
    sourceId: row.source_id ? String(row.source_id) : null,
    withdrawn: Number(row.withdrawn ?? 0) === 1,
    createdAt: String(row.created_at),
  };
}

export function feedbackSummary(limit = 2000, market?: string): FeedbackSummary {
  const where = market ? 'WHERE market = ?' : '';
  const params: unknown[] = market ? [market, limit] : [limit];
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT market, verdict, reasons, rater, withdrawn FROM feedback ${where} ORDER BY created_at DESC LIMIT ?`,
    params,
  );
  const byMarket = new Map<string, { likes: number; dislikes: number }>();
  const reasons = new Map<string, number>();
  const raters = new Set<string>();
  let likes = 0;
  let dislikes = 0;
  let unattributed = 0;
  let withdrawn = 0;

  for (const row of rows) {
    const marketKey = row.market ? String(row.market) : '-';
    const verdict = String(row.verdict);
    const isWithdrawn = Number(row.withdrawn ?? 0) === 1;
    if (row.rater) raters.add(String(row.rater));
    if (isWithdrawn) withdrawn += 1;
    const entry = byMarket.get(marketKey) ?? { likes: 0, dislikes: 0 };
    if (verdict === 'dislike') {
      dislikes += 1;
      entry.dislikes += 1;
    } else {
      likes += 1;
      entry.likes += 1;
    }
    byMarket.set(marketKey, entry);

    const named = jsonParse<string[]>(row.reasons, []);
    if (named.length === 0 && verdict === 'dislike') unattributed += 1;
    for (const reason of named) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  // Votes are counted separately from verdicts: one verdict can produce several votes (one per weight
  // key it blamed), and the promotion gate is measured in votes and raters, not in button presses.
  const voteWhere = market ? 'WHERE market = ?' : '';
  const voteParams: unknown[] = market ? [market] : [];
  const { rows: voteRows } = pool.query<Record<string, unknown>>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN promoted_at IS NOT NULL THEN 1 ELSE 0 END) AS promoted,
            SUM(CASE WHEN promoted_at IS NULL AND withdrawn_at IS NULL THEN 1 ELSE 0 END) AS pending,
            COUNT(DISTINCT CASE WHEN promoted_at IS NOT NULL THEN feedback_id END) AS promoted_rows
     FROM feedback_votes ${voteWhere}`,
    voteParams,
  );
  const voteStats = voteRows[0] ?? {};

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
    raters: raters.size,
    withdrawn,
    promoted: Number(voteStats.promoted_rows ?? 0),
    pending: Number(voteStats.pending ?? 0),
  };
}
