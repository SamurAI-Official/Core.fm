/**
 * Decay: an opinion goes stale, so a weight walks back toward neutral when nobody has moved it.
 *
 * Without this, learning only ever accumulates in one direction. The tests made that concrete - four
 * hard nos drive a key to its 0.25 floor and it stays there for ever, and the same is now true of a
 * listener's own profile, which one person can pin to the floor in four clicks. A weight is a summary
 * of what recent listeners wanted, not a permanent verdict on a genre, so it needs a way back.
 *
 * The rule is a half-life rather than a cliff: `(1 - rate)^weeks` of the distance from neutral is left
 * after a week, so at the default 2%/week a fully damped key (0.25) is back to about 0.9 after ten
 * weeks, and a strongly favoured one (3.0) comes down over the same period. Nothing jumps, and a key
 * that keeps being confirmed never moves at all.
 *
 * Two properties are what make it safe to run often:
 *
 *   - it is a function of *time since the value last changed*, not of how often the pass runs, so
 *     running every six hours and running once a month produce the same weights (the rate is per week,
 *     and the maths composes);
 *   - a key nobody has touched for ten minutes is left alone rather than nudged by a rounding error,
 *     and its clock is *not* reset when that happens - so accumulation continues from the last real
 *     change.
 *
 * The clock is `decayed_at`, separate from `updated_at`, so "when was this last learned" stays a
 * readable fact rather than being rewritten by every pass.
 */
import { config } from '../config.js';
import { pool } from '../db/index.js';
import { round } from '../lib/util.js';
import { getMeta, setMeta } from '../sources/store.js';

/** A weight within this distance of neutral is neutral: the row is deleted, not kept as a no-op. */
const PURGE_TOLERANCE = 0.005;
/** Below this, a pass is not worth a write; the clock keeps running from the last real change. */
const MIN_SHIFT = 0.0001;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Guard against a clock skew or a hand-edited row producing an absurd exponent. */
const MAX_WEEKS = 520;

export interface DecayExample {
  scope: string;
  key: string;
  from: number;
  to: number;
}

export interface DecayScopeReport {
  table: string;
  examined: number;
  moved: number;
  purged: number;
  /** How far the clock has run on this scope's keys, in weeks (the largest, for reporting). */
  oldestWeeks: number;
  largestShift: number;
  examples: DecayExample[];
}

export interface DecayReport {
  ranAt: string;
  ratePerWeek: number;
  weeksSinceLastPass: number | null;
  dryRun: boolean;
  scopes: DecayScopeReport[];
}

interface ScopeSpec {
  table: string;
  scopeColumn: string;
}

const SCOPES: ScopeSpec[] = [
  { table: 'market_weights', scopeColumn: 'market' },
  { table: 'user_weights', scopeColumn: 'rater' },
];

const META_KEY = 'weights_decayed_at';

/**
 * The value a weight has after decaying for `weeks` untouched.
 *
 * Exported because it *is* the rule rather than an implementation detail: the tests check it directly
 * against the arithmetic, instead of only checking that "something moved".
 */
export function decayedValue(value: number, ratePerWeek: number, weeks: number): number {
  const rate = Math.min(0.99, Math.max(0, ratePerWeek));
  const span = Math.min(MAX_WEEKS, Math.max(0, weeks));
  return 1 + (value - 1) * (1 - rate) ** span;
}

/** One scope's pass: what moved, what settled back to neutral, and the largest shift. */
function decayScope(spec: ScopeSpec, options: { now: Date; rate: number; dryRun: boolean }): DecayScopeReport {
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT ${spec.scopeColumn} AS scope, key, value, updated_at, decayed_at FROM ${spec.table}`,
  );
  const report: DecayScopeReport = {
    table: spec.table,
    examined: rows.length,
    moved: 0,
    purged: 0,
    oldestWeeks: 0,
    largestShift: 0,
    examples: [],
  };

  for (const row of rows) {
    const scope = String(row.scope);
    const key = String(row.key);
    const value = Number(row.value);
    // The clock starts at the last time this value changed for any reason: learning wrote it, or a
    // previous pass decayed it. Whichever is later.
    const basis = String(row.decayed_at ?? row.updated_at);
    const since = options.now.getTime() - new Date(`${basis.replace(' ', 'T')}Z`).getTime();
    if (!Number.isFinite(since) || since <= 0) continue;

    const weeks = since / WEEK_MS;
    const next = decayedValue(value, options.rate, weeks);
    report.oldestWeeks = Math.max(report.oldestWeeks, weeks);
    if (Math.abs(next - value) < MIN_SHIFT) continue;

    // Only weights that *decayed into* neutral are retired. A weight that was already within the
    // tolerance when it was written is a preference too small to act on, and deleting it the moment it
    // arrives would both lose it and report a "dropped back to neutral" that never happened.
    const wasAnOpinion = Math.abs(value - 1) > PURGE_TOLERANCE;
    const settled = wasAnOpinion && Math.abs(next - 1) <= PURGE_TOLERANCE;
    const rounded = round(next, 4);
    report.moved += 1;
    report.largestShift = Math.max(report.largestShift, Math.abs(rounded - value));
    if (report.examples.length < 5) {
      report.examples.push({ scope, key, from: value, to: settled ? 1 : rounded });
    }
    if (settled) report.purged += 1;
    if (options.dryRun) continue;

    if (settled) {
      // Neutral means no opinion, so the row is removed rather than kept as a 1.0 placeholder: the
      // tables stay a summary of current taste rather than an archive of everything ever judged. The
      // history is in the ledger (feedback, feedback_votes), which nothing here touches.
      pool.query(`DELETE FROM ${spec.table} WHERE ${spec.scopeColumn} = ? AND key = ?`, [scope, key]);
      continue;
    }

    pool.query(
      `UPDATE ${spec.table} SET value = ?, decayed_at = datetime('now') WHERE ${spec.scopeColumn} = ? AND key = ?`,
      [rounded, scope, key],
    );
  }

  return report;
}


/**
 * Runs one decay pass over both scopes: market weights and listeners' own profiles.
 *
 * Both, deliberately. The failure this exists to prevent - a handful of early clicks shaping the
 * weights for ever - applies equally to a market and to one person, and there is no reading of "an
 * opinion goes stale" under which an individual's own profile should be the permanent one.
 */
export function decayWeights(options: { dryRun?: boolean; now?: Date; ratePerWeek?: number } = {}): DecayReport {
  const now = options.now ?? new Date();
  const rate = options.ratePerWeek ?? config.scoring.decayPerWeek;
  const previous = getMeta(META_KEY);
  const previousDate = previous ? new Date(`${previous.replace(' ', 'T')}Z`) : null;
  const weeksSinceLastPass = previousDate ? (now.getTime() - previousDate.getTime()) / WEEK_MS : null;

  const scopes = SCOPES.map((spec) => decayScope(spec, { now, rate, dryRun: options.dryRun === true }));
  const ranAt = now.toISOString().replace('T', ' ').slice(0, 19);

  // "When was this last decayed" is only worth recording when something was written: a dry run must
  // leave the database exactly as it found it, including that clock.
  if (options.dryRun !== true) setMeta(META_KEY, ranAt);

  return {
    ranAt,
    ratePerWeek: rate,
    weeksSinceLastPass: weeksSinceLastPass === null ? null : round(weeksSinceLastPass, 2),
    dryRun: options.dryRun === true,
    scopes,
  };
}

/** When the last pass ran and how strong the rule is - for a dashboard, without running anything. */
export function decayStatus(): { lastPassAt: string | null; ratePerWeek: number; purgeTolerance: number } {
  return {
    lastPassAt: getMeta(META_KEY) ?? null,
    ratePerWeek: config.scoring.decayPerWeek,
    purgeTolerance: PURGE_TOLERANCE,
  };
}

/** One line per scope, for the CLI, the cycle log and the API response. */
export function describeDecay(report: DecayReport): string[] {
  const lines: string[] = [];
  const verb = report.dryRun ? 'would decay' : 'decayed';
  for (const scope of report.scopes) {
    lines.push(
      `${scope.table}: ${verb} ${scope.moved} of ${scope.examined}` +
        (scope.purged > 0 ? `, dropped ${scope.purged} back to neutral` : '') +
        (scope.largestShift > 0 ? `, largest shift ${scope.largestShift.toFixed(3)}` : '') +
        (scope.oldestWeeks > 0 ? ` (oldest untouched ${scope.oldestWeeks.toFixed(1)}w)` : ''),
    );
    for (const example of scope.examples) {
      lines.push(`  ${example.scope} ${example.key}: ${example.from.toFixed(3)} -> ${example.to.toFixed(3)}`);
    }
  }
  lines.push(`rate: ${(report.ratePerWeek * 100).toFixed(2)}%/week toward neutral`);
  return lines;
}

