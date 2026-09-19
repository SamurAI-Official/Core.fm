/**
 * Data quality report for collected signals. Handy after a collection run to see
 * how much of each market could actually be enriched.
 *
 *   npx tsx scripts/db-stats.ts
 */
import { pool } from '../src/db/index.js';

interface Row {
  market: string;
  source: string;
  n: number;
  enriched: number;
  bpms: number;
  durations: number;
}

const totals = pool.query<Row>(`
  SELECT market, source, COUNT(1) AS n,
         SUM(enriched) AS enriched,
         SUM(CASE WHEN bpm > 0 THEN 1 ELSE 0 END) AS bpms,
         SUM(CASE WHEN duration_ms > 0 THEN 1 ELSE 0 END) AS durations
  FROM signals
  GROUP BY market, source
  ORDER BY market, source
`);

console.log('signals by market/source');
console.table(
  totals.rows.map((row) => ({
    market: row.market,
    source: row.source,
    tracks: row.n,
    enriched: row.enriched,
    withBpm: row.bpms,
    withDuration: row.durations,
  })),
);

const genres = pool.query<{ canonical_genres: string; n: number }>(`
  SELECT canonical_genres, COUNT(1) AS n
  FROM signals
  WHERE market != 'global'
  GROUP BY canonical_genres
  ORDER BY n DESC
  LIMIT 15
`);
console.log('canonical genres (non-global)');
console.table(genres.rows);

const counts = pool.query<{ table_name: string; n: number }>(`
  SELECT 'briefs' AS table_name, COUNT(1) AS n FROM market_briefs
  UNION ALL SELECT 'concepts', COUNT(1) FROM concepts
  UNION ALL SELECT 'runs', COUNT(1) FROM runs
  UNION ALL SELECT 'ratings', COUNT(1) FROM ratings
  UNION ALL SELECT 'weights', COUNT(1) FROM market_weights
`);
console.log('loop state');
console.table(counts.rows);

interface RunRow {
  id: string;
  market: string;
  status: string;
  duration: number | null;
  reported_bpm: number | null;
  reported_key: string | null;
  market_fit: number | null;
  novelty: number | null;
  composite: number | null;
  verdict: string | null;
  human_score: number | null;
}

const runs = pool.query<RunRow>(`
  SELECT id, market, status, duration, reported_bpm, reported_key,
         market_fit, novelty, composite, verdict, human_score
  FROM runs
  ORDER BY started_at DESC
  LIMIT 12
`);
console.log('runs');
console.table(
  runs.rows.map((row) => ({
    run: row.id.slice(0, 8),
    market: row.market,
    status: row.status,
    sec: row.duration,
    bpm: row.reported_bpm,
    key: row.reported_key,
    fit: row.market_fit,
    nov: row.novelty,
    comp: row.composite,
    verdict: row.verdict,
    human: row.human_score,
  })),
);

const weights = pool.query<{ market: string; key: string; value: number }>(`
  SELECT market, key, value FROM market_weights ORDER BY market, key LIMIT 25
`);
if (weights.rows.length > 0) {
  console.log('learned weights');
  console.table(weights.rows);
}

const latestConcept = pool.query<{ market: string; title: string; style: string; lyrics: string }>(`
  SELECT market, title, style, lyrics FROM concepts ORDER BY created_at DESC LIMIT 1
`);
if (latestConcept.rows[0]) {
  const concept = latestConcept.rows[0];
  console.log(`\nlatest concept: ${concept.market} / ${concept.title}`);
  console.log(concept.style);
  console.log('--- lyrics scaffold ---');
  console.log(concept.lyrics || '(instrumental)');
}