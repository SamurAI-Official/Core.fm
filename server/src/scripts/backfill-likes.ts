/**
 * Replays the app's existing likes into the loop's ledger.
 *
 * Why this exists: the app has recorded likes since long before the loop could learn from them, and the
 * older like route wrote `liked_songs` and stopped. Those likes are real judgements by real listeners, so
 * the loop should have them - and on this install ten of eleven likes were invisible to it, which made a
 * used app look like an empty training corpus.
 *
 * Two properties, both deliberate:
 *
 *   - **the rater is the app user**, spelled exactly as the live routes spell it (`app:<user id>`). So a
 *     backfilled like and a like clicked afterwards are the *same person* to the agreement gate, and a
 *     later change of mind replaces this row rather than arriving beside it;
 *   - **it is safe to run twice.** The aggregator answers a replayed verdict (same rater, same response,
 *     same verdict) without writing anything, so re-running reports `replayed` and changes nothing. That
 *     is also why there is no "skip if already done" bookkeeping here, which would be a second source of
 *     truth about what the ledger holds.
 *
 * `--dry-run` reports what it would send and sends nothing. In npm, pass flags after `--` *with* their
 * values (`npm run likes:backfill -- --dry-run`), because npm consumes bare flags of its own.
 */
import { pool } from '../db/pool.js';
import { forwardVerdict, parseParams } from '../services/preference.js';

interface LikedRow {
  user_id: string;
  song_id: string;
  prompt_id: string | null;
  generation_params: string | null;
  liked_at: string | null;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run') || process.env.npm_config_dry_run === 'true';
  const { rows } = await pool.query<LikedRow>(
    `SELECT l.user_id, l.song_id, s.prompt_id, s.generation_params, l.liked_at
     FROM liked_songs l JOIN songs s ON s.id = l.song_id
     ORDER BY l.liked_at ASC`
  );

  console.log(
    `[likes:backfill] ${rows.length} like(s) in liked_songs${dryRun ? ' | DRY RUN - nothing will be sent' : ''}`
  );
  if (rows.length === 0) {
    await pool.end();
    return;
  }

  let recorded = 0;
  let replayed = 0;
  let attributed = 0;
  let failed = 0;
  let wouldReport = 0;

  for (const row of rows) {
    const params = parseParams(row.generation_params);
    const market = typeof params.market === 'string' && params.market ? params.market : null;
    if (market) attributed += 1;
    if (dryRun) {
      wouldReport += 1;
      console.log(
        `  would report like  song ${row.song_id}  rater app:${row.user_id}  ` +
          `market ${market ?? '-'}  liked ${row.liked_at ?? '-'}`
      );
      continue;
    }
    const outcome = await forwardVerdict({
      songId: String(row.song_id),
      userId: String(row.user_id),
      verdict: 'like',
      reasons: [],
      params,
      promptId: row.prompt_id ? String(row.prompt_id) : null,
      source: 'app-backfill',
    });
    if (!outcome.ok) {
      failed += 1;
      console.log(`  FAILED   song ${row.song_id}: ${outcome.error ?? 'unknown error'}`);
      continue;
    }
    if (outcome.replayed) {
      replayed += 1;
      continue;
    }
    recorded += 1;
    const moved = outcome.profile.length > 0 ? ` | profile: ${outcome.profile.join(', ')}` : '';
    const pending = outcome.pending.length > 0
      ? ` | pending: ${outcome.pending.map((p) => `${p.key} ${p.raters}/${p.needed}`).join(', ')}`
      : '';
    console.log(
      `  recorded like  song ${row.song_id}  market ${outcome.market ?? '-'}${moved}${pending}`
    );
  }

  console.log(
    `[likes:backfill] ${dryRun ? `would report ${wouldReport}` : `recorded ${recorded}`} | ` +
      `already known ${replayed} | attributed to a market ${attributed} | failed ${failed}`
  );
  if (failed > 0) {
    console.log(
      '[likes:backfill] failures are reported, not raised: a local app must not fail because the ' +
        'aggregator is not running. Start the aggregator and run this again - re-running is safe.'
    );
  }
  await pool.end();
}

run().catch(async (error) => {
  console.error('[likes:backfill] fatal:', error);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
