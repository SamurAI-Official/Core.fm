/**
 * A listener's own profile: what this person wants more and less of.
 *
 * The market gate exists because one person should not decide what a *market* hears. It has no place
 * here: a hard no is the listener's own statement about their own generation, it costs nothing to
 * honour, and it should change the next thing they hear from the very next attempt. So this layer has
 * no threshold, no window and no votes - it applies immediately, keyed by rater, and uses the same key
 * grammar and bounds as the market weights so the two can be read side by side (and, later, blended).
 *
 * Nothing here is ever deleted: a profile that only remembers the last few verdicts would forget what
 * someone disliked a month ago. The strength of a preference is its weight, and (as with the market)
 * the bounds of 0.25 and 3 are what stop a handful of clicks becoming an absolute.
 */
import { pool } from '../db/index.js';
import { round } from '../lib/util.js';
import type { WeightStep } from '../scoring/feedback.js';
import { clamp } from '../lib/util.js';

/** Lower and upper bounds, matching the market weights: a preference can be strong, never absolute. */
const MIN_WEIGHT = 0.25;
const MAX_WEIGHT = 3;

export interface UserWeight {
  key: string;
  value: number;
  updatedAt: string;
}

export function getUserWeights(rater: string): UserWeight[] {
  const { rows } = pool.query<Record<string, unknown>>(
    'SELECT key, value, updated_at FROM user_weights WHERE rater = ? ORDER BY value ASC',
    [rater],
  );
  return rows.map((row) => ({
    key: String(row.key),
    value: Number(row.value),
    updatedAt: String(row.updated_at),
  }));
}

/** One key's weight for this listener; 1 (neutral) when they have never judged it. */
export function getUserWeight(rater: string, key: string, fallback = 1): number {
  const { rows } = pool.query<Record<string, unknown>>(
    'SELECT value FROM user_weights WHERE rater = ? AND key = ?',
    [rater, key],
  );
  return rows[0] ? Number(rows[0].value) : fallback;
}

/** Applies steps to a listener's profile, clamped, and describes what each key became. */
export function applyUserSteps(rater: string, steps: WeightStep[]): string[] {
  const applied: string[] = [];
  for (const step of steps) {
    if (step.delta === 0) continue;
    const current = getUserWeight(rater, step.key, 1);
    const next = clamp(current + step.delta, MIN_WEIGHT, MAX_WEIGHT);
    pool.query(
      `INSERT INTO user_weights (rater, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(rater, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [rater, step.key, round(next, 4)],
    );
    applied.push(`${step.key} -> ${round(next, 3)}`);
  }
  return applied;
}

/**
 * Takes back the profile changes a verdict made, by applying the opposite of the steps it decided.
 *
 * "Roughly", for the same reason as the market's reversal: values are clamped to 0.25..3 and decay moves
 * them as time passes, so reversing a step that was itself clamped or since decayed cannot land on the
 * exact earlier number. What it guarantees is the direction: what the listener asked for is no longer
 * counted in their profile.
 */
export function reverseUserSteps(rater: string, steps: WeightStep[]): string[] {
  const reversed: string[] = [];
  for (const step of steps) {
    if (step.delta === 0) continue;
    const current = getUserWeight(rater, step.key, 1);
    const next = clamp(current - step.delta, MIN_WEIGHT, MAX_WEIGHT);
    pool.query(
      `INSERT INTO user_weights (rater, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(rater, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [rater, step.key, round(next, 4)],
    );
    reversed.push(`${step.key} -> ${round(next, 3)}`);
  }
  return reversed;
}

export interface UserProfile {
  rater: string;
  /** How many verdicts the profile is built from - the honest measure of how much to trust it. */
  verdicts: number;
  /** Keys this listener wants more of, strongest first. */
  prefers: UserWeight[];
  /** Keys they want less of, strongest objection first. */
  avoids: UserWeight[];
  updatedAt: string | null;
}

/**
 * The profile as preferences rather than weights.
 *
 * `verdicts` is the confidence: a profile built from one click should not be treated like one built
 * from fifty, which is why it is reported alongside the preferences instead of being folded into them.
 */
export function userProfile(rater: string, limit = 12): UserProfile {
  const weights = getUserWeights(rater);
  const { rows } = pool.query<Record<string, unknown>>(
    'SELECT COUNT(*) AS n FROM feedback WHERE rater = ? AND withdrawn = 0',
    [rater],
  );
  return {
    rater,
    verdicts: Number(rows[0]?.n ?? 0),
    avoids: weights.filter((w) => w.value < 1).slice(0, limit),
    prefers: weights.filter((w) => w.value > 1).reverse().slice(0, limit),
    updatedAt: weights.length > 0 ? weights[weights.length - 1].updatedAt : null,
  };
}

/** The kind of key a profile entry is, for callers that only care about one family (e.g. `agent:`). */
export function weightFamily(key: string): string {
  const index = key.indexOf(':');
  return index === -1 ? key : key.slice(0, index);
}

/**
 * The listener's weight for a whole family, averaged: "how does this person feel about writing styles
 * in general". Used where a choice has to be made from a family rather than about one known id.
 */
export function familyWeight(rater: string, family: string): number {
  const weights = getUserWeights(rater).filter((w) => weightFamily(w.key) === family);
  if (weights.length === 0) return 1;
  return weights.reduce((total, w) => total + w.value, 0) / weights.length;
}
