/**
 * Reconciles runs that can never finish.
 *
 * A run is only advanced by the aggregator process that started it (it polls the
 * pipeline in-process). If that process is restarted while a render is in flight,
 * the row stays 'queued'/'running' forever. This marks such rows failed so the UI
 * reflects reality instead of showing a zombie job.
 *
 *   npx tsx scripts/reconcile-runs.ts [--minutes 30]
 */
import { pool } from '../src/db/index.js';

const args = process.argv.slice(2);
const minutesIndex = args.indexOf('--minutes');
const minutes = minutesIndex >= 0 ? Number(args[minutesIndex + 1]) || 30 : 30;

const stalled = pool.query<{ id: string; market: string; started_at: string; status: string }>(
  `SELECT id, market, started_at, status FROM runs
   WHERE status IN ('queued', 'running')
     AND datetime(started_at) < datetime('now', ?)
   ORDER BY started_at ASC`,
  [`-${minutes} minutes`],
);

if (stalled.rows.length === 0) {
  console.log(`No stalled runs older than ${minutes} minutes.`);
} else {
  for (const run of stalled.rows) {
    pool.query(
      `UPDATE runs SET status = 'failed', finished_at = datetime('now'),
                       error = COALESCE(error, 'run orphaned: the aggregator restarted while this render was in flight')
       WHERE id = ?`,
      [run.id],
    );
    console.log(`failed ${run.id.slice(0, 8)} (${run.market}, started ${run.started_at}, was ${run.status})`);
  }
  console.log(`Reconciled ${stalled.rows.length} stalled run(s).`);
}

const summary = pool.query<{ status: string; n: number }>(
  'SELECT status, COUNT(1) AS n FROM runs GROUP BY status ORDER BY n DESC',
);
console.table(summary.rows);