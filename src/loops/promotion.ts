/**
 * The agreement gate between a listener's verdict and a market's weights.
 *
 * A verdict is recorded the instant it arrives - it is a fact about what one person heard - but it
 * does not move the market on its own. `feedback_votes` holds, per weight key, which listeners asked
 * for more or less of it; this module counts *distinct* raters within a window and moves the weights
 * only when `config.feedback.minUsers` of them agree.
 *
 * Two failure modes are what this exists to prevent, in opposite directions:
 *
 *   - one person finding the dislike button and thereby reshaping a whole market's taste (the gate),
 *   - and a veto that goes nowhere at all (which is why the gate is this thin - the verdict is still
 *     recorded, still attributed, and still visible as pending until it either crosses or goes stale).
 *
 * With `FEEDBACK_PROMOTE=false` nothing here writes: the group is still reported as pending, so a
 * deployment can watch the distribution of votes before letting any of them act.
 */
import { config } from '../config.js';
import { pool } from '../db/index.js';
import { round } from '../lib/util.js';
import { applySteps, type WeightStep } from '../scoring/feedback.js';
import { getWeight } from './ratings.js';

export interface PromotionEvent {
  market: string;
  key: string;
  /** -1 for "less of this", +1 for "more of it". */
  sign: number;
  /** How many distinct raters asked for it. */
  raters: number;
  /** How many votes those raters cast (one person can judge several responses). */
  votes: number;
  /** The summed delta the votes asked for. */
  delta: number;
  /** Where the weight stood before, and after (null when the promotion was not applied). */
  before: number;
  after: number | null;
  /** False when `config.feedback.promote` is off, i.e. this is only a preview of what would happen. */
  applied: boolean;
  /** True when the sum was not applied in full because the weight is clamped at 0.25 or 3. */
  clampedToBound: boolean;
}

/** Groups of un-promoted votes, with their agreement counted. */
interface VoteGroup {
  market: string;
  key: string;
  sign: number;
  rowIds: number[];
  raters: Set<string>;
}

function windowModifier(): string {
  const days = Math.max(1, Math.round(config.feedback.windowDays));
  return `-${days} days`;
}

/** Votes that no promotion has acted on yet, and that have not been retracted. */
function unPromotedVotes(market?: string): Array<Record<string, unknown>> {
  const clauses = ["promoted_at IS NULL", "withdrawn_at IS NULL", "created_at >= datetime('now', ?)"];
  const params: unknown[] = [windowModifier()];
  if (market) {
    clauses.push('market = ?');
    params.push(market);
  }
  return pool.query<Record<string, unknown>>(
    `SELECT rowid AS id, market, key, sign, rater, delta
     FROM feedback_votes
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at ASC`,
    params,
  ).rows;
}

/**
 * Every key that listeners have voted on and that has not yet been acted on, with how much agreement
 * it has. Includes groups that are still short of the threshold - that is the "2 of 3 listeners
 * agree" state the UI and the ledger report.
 */
export function pendingPromotions(market?: string): PromotionEvent[] {
  const groups = new Map<string, VoteGroup & { delta: number; votes: number }>();
  for (const row of unPromotedVotes(market)) {
    const groupMarket = String(row.market);
    const key = String(row.key);
    const sign = Number(row.sign);
    const id = `${groupMarket}|${key}|${sign}`;
    const group =
      groups.get(id) ?? {
        market: groupMarket,
        key,
        sign,
        rowIds: [],
        raters: new Set<string>(),
        delta: 0,
        votes: 0,
      };
    group.rowIds.push(Number(row.id));
    // A vote with no rater cannot be told apart from another vote with no rater, so they count as one
    // anonymous listener. Anything else would let a caller with no identity reach the threshold alone.
    group.raters.add(row.rater ? String(row.rater) : 'anon');
    group.delta += Number(row.delta);
    group.votes += 1;
    groups.set(id, group);
  }

  return [...groups.values()]
    .map((group) => ({
      market: group.market,
      key: group.key,
      sign: group.sign,
      raters: group.raters.size,
      votes: group.votes,
      delta: round(group.delta, 4),
      before: round(getWeight(group.market, group.key, 1), 4),
      after: null,
      applied: false,
      clampedToBound: false,
    }))
    .sort((a, b) => b.raters - a.raters || a.key.localeCompare(b.key));
}

/**
 * Applies the groups that have reached the threshold and marks their votes as promoted, so a later
 * promotion counts only what has arrived since.
 *
 * The step taken is the sum of what the agreeing listeners asked for (bounded by the usual 0.25..3
 * clamp), not a fixed nudge: three people saying "less of this" asked for three times one person's
 * complaint, and the clamp is what keeps that from being a cliff.
 */
export function promoteFeedback(options: { market?: string; limit?: number } = {}): PromotionEvent[] {
  const threshold = Math.max(1, config.feedback.minUsers);
  const candidates = pendingPromotions(options.market).filter((event) => event.raters >= threshold);
  const limited = options.limit ? candidates.slice(0, options.limit) : candidates;
  if (limited.length === 0) return [];
  if (!config.feedback.promote) return limited;

  const voteRows = unPromotedVotes(options.market);
  const events: PromotionEvent[] = [];
  for (const candidate of limited) {
    const ids = voteRows
      .filter(
        (row) =>
          String(row.market) === candidate.market &&
          String(row.key) === candidate.key &&
          Number(row.sign) === candidate.sign,
      )
      .map((row) => Number(row.id));

    const step: WeightStep = { key: candidate.key, delta: candidate.delta };
    applySteps(candidate.market, [step]);
    const after = getWeight(candidate.market, candidate.key, 1);
    for (const id of ids) {
      pool.query("UPDATE feedback_votes SET promoted_at = datetime('now') WHERE rowid = ?", [id]);
    }
    events.push({
      ...candidate,
      after: round(after, 4),
      applied: true,
      // The requested delta and the weight change can differ: the bounds are 0.25 and 3.
      clampedToBound: Math.abs(candidate.before + candidate.delta - after) > 1e-4,
    });
  }
  return events;
}

/**
 * A trusted rater's own votes, applied without waiting for agreement.
 *
 * The gate exists to stop one *person* reshaping a market's taste. A rater named in
 * `FEEDBACK_TRUSTED_RATERS` is an exemption from that, and it is deliberately narrow in three ways:
 *
 *   - **only that rater's votes move.** The query is scoped by rater, so a trusted rater cannot carry
 *     anyone else's pending votes across the threshold with its own;
 *   - **nothing is exempt from the rest.** The daily cap still stops a flood before there is a plan to
 *     vote on, `FEEDBACK_PROMOTE=false` still writes nothing at all, and the window still applies, so a
 *     stale verdict of an agent's does not act months later;
 *   - **it is a flag, not an identity.** Trust lives in configuration rather than in the rater's name, so
 *     the same rater is an ordinary listener the moment it is removed - and every vote it cast records
 *     who cast it, so a market's weights can always be explained by the raters behind them.
 *
 * An agent whose verdicts should teach only its *own* profile is what happens with an empty
 * `FEEDBACK_TRUSTED_RATERS`: Layer U still applies its verdicts at once, and the market waits.
 */
export function promoteRaterVotes(options: { market: string; rater: string }): PromotionEvent[] {
  if (!config.feedback.promote) return [];
  const rows = pool.query<Record<string, unknown>>(
    `SELECT rowid AS id, key, sign, delta FROM feedback_votes
     WHERE market = ? AND rater = ? AND promoted_at IS NULL AND withdrawn_at IS NULL
       AND created_at >= datetime('now', ?)
     ORDER BY created_at ASC`,
    [options.market, options.rater, windowModifier()],
  ).rows;
  if (rows.length === 0) return [];

  const groups = new Map<string, { key: string; sign: number; delta: number; ids: number[] }>();
  for (const row of rows) {
    const key = String(row.key);
    const sign = Number(row.sign);
    const id = `${key}|${sign}`;
    const group = groups.get(id) ?? { key, sign, delta: 0, ids: [] };
    group.delta += Number(row.delta);
    group.ids.push(Number(row.id));
    groups.set(id, group);
  }

  const events: PromotionEvent[] = [];
  for (const group of groups.values()) {
    const before = round(getWeight(options.market, group.key, 1), 4);
    applySteps(options.market, [{ key: group.key, delta: group.delta } as WeightStep]);
    const after = round(getWeight(options.market, group.key, 1), 4);
    for (const id of group.ids) {
      pool.query("UPDATE feedback_votes SET promoted_at = datetime('now') WHERE rowid = ?", [id]);
    }
    events.push({
      market: options.market,
      key: group.key,
      sign: group.sign,
      raters: 1,
      votes: group.ids.length,
      delta: round(group.delta, 4),
      before,
      after,
      applied: true,
      clampedToBound: Math.abs(before + group.delta - after) > 1e-4,
    });
  }
  return events;
}

export interface WithdrawalResult {
  found: boolean;
  /** Votes that had never been acted on, so they simply stop counting. */
  released: number;
  /** Votes that had already moved a weight, undone by applying the opposite step. */
  reversed: string[];
}

/**
 * Takes back a verdict: the person who gave it changed their mind, so it must stop counting.
 *
 * Votes that never crossed the threshold are released (they were never acted on, so there is nothing
 * to undo). Votes that did are reversed by applying the opposite delta, so the market returns to
 * roughly where it stood. "Roughly" is honest: the weights are clamped to 0.25..3, so reversing a step
 * that was itself clamped cannot land on the exact earlier value.
 */
export function withdrawFeedback(input: { market: string; feedbackId: string }): WithdrawalResult {
  const { rows } = pool.query<Record<string, unknown>>(
    'SELECT rowid AS id, key, delta, promoted_at, withdrawn_at FROM feedback_votes WHERE feedback_id = ?',
    [input.feedbackId],
  );
  let released = 0;
  const reversed: string[] = [];

  for (const row of rows) {
    const isWithdrawn = row.withdrawn_at !== null && row.withdrawn_at !== undefined;
    if (isWithdrawn) continue;
    const isPromoted = row.promoted_at !== null && row.promoted_at !== undefined;
    if (isPromoted) {
      // Put back what this vote moved.
      reversed.push(...applySteps(input.market, [{ key: String(row.key), delta: -Number(row.delta) }]));
    } else {
      released += 1;
    }
    pool.query("UPDATE feedback_votes SET withdrawn_at = datetime('now') WHERE rowid = ?", [Number(row.id)]);
  }

  return { found: rows.length > 0, released, reversed };
}


