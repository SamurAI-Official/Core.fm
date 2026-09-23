/**
 * Who is trusted to move a market's weights without agreement - the flag, and its flip.
 *
 * `FEEDBACK_TRUSTED_RATERS` is the *seed*, not the switch. It is read once at migration and written into
 * `trusted_raters`, which is what every decision consults. That split exists because of what this flag does:
 * it exempts one rater from the agreement gate, so turning it on or off should be a deliberate act with a
 * record, not something that depends on how a service happened to be launched. An entry records where it came
 * from (`env` or `api`) and when, so "why is this market moving on one agent's word?" has an answer.
 *
 * Trust is not an identity: removing the row returns that rater to the ordinary gate, with nothing else
 * changed, and every vote it ever cast keeps the rater id that cast it.
 */
import { config } from '../config.js';
import { pool } from '../db/index.js';

export interface TrustedRater {
  rater: string;
  /** `env` when it came from the configuration seed, `api` when somebody flipped it at runtime. */
  source: string;
  note: string | null;
  addedAt: string;
}

export function listTrustedRaters(): TrustedRater[] {
  const { rows } = pool.query<Record<string, unknown>>(
    'SELECT rater, source, note, created_at FROM trusted_raters ORDER BY created_at ASC, rater ASC',
  );
  return rows.map((row) => ({
    rater: String(row.rater),
    source: String(row.source ?? 'api'),
    note: row.note ? String(row.note) : null,
    addedAt: String(row.created_at),
  }));
}

export function isTrustedRater(rater: string | null | undefined): boolean {
  if (!rater) return false;
  const { rows } = pool.query<Record<string, unknown>>('SELECT 1 AS found FROM trusted_raters WHERE rater = ?', [
    rater,
  ]);
  return rows.length > 0;
}

/**
 * Seeds the table from `FEEDBACK_TRUSTED_RATERS`, once per name.
 *
 * Additive on purpose: a name already recorded is left alone, so a restart does not rewrite when a rater was
 * trusted or who trusted it. An env entry that is later removed from the configuration stays in force until
 * somebody removes it here - which is stated in the README, because the alternative (env silently winning)
 * would make the flag impossible to reason about when two people disagree about it.
 */
export function seedTrustedRaters(): { added: string[] } {
  const added: string[] = [];
  for (const rater of config.feedback.trustedRaters) {
    const { rows } = pool.query<Record<string, unknown>>('SELECT 1 AS found FROM trusted_raters WHERE rater = ?', [
      rater,
    ]);
    if (rows.length > 0) continue;
    pool.query(
      "INSERT INTO trusted_raters (rater, source, note, created_at) VALUES (?, 'env', ?, datetime('now'))",
      [rater, 'from FEEDBACK_TRUSTED_RATERS at startup'],
    );
    added.push(rater);
  }
  return { added };
}

/** Turns trust on or off for one rater. Idempotent in both directions. */
export function setTrustedRater(input: { rater: string; enabled: boolean; note?: string }): {
  rater: string;
  enabled: boolean;
  changed: boolean;
} {
  const rater = input.rater.trim();
  if (!rater) throw new Error('rater is required');
  const already = isTrustedRater(rater);
  if (input.enabled && !already) {
    pool.query(
      "INSERT INTO trusted_raters (rater, source, note, created_at) VALUES (?, 'api', ?, datetime('now'))",
      [rater, input.note ?? null],
    );
    return { rater, enabled: true, changed: true };
  }
  if (!input.enabled && already) {
    pool.query('DELETE FROM trusted_raters WHERE rater = ?', [rater]);
    return { rater, enabled: false, changed: true };
  }
  return { rater, enabled: already, changed: false };
}
