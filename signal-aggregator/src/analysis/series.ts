/**
 * Time-series analytics over collected snapshots.
 *
 * Everything here reads from `signals` joined to `signal_snapshots`: the snapshot
 * row supplies the authoritative capture time for a whole collection pass, so
 * rows written seconds apart within one pass collapse into a single observation
 * instead of being mistaken for two different measurements.
 *
 * Why this exists: "popular" is a snapshot, but "trending" is a derivative. A
 * forecast needs at least two points per track, and today the database holds only
 * a couple of hours of history - so every function here reports its own sample
 * depth rather than implying confidence it does not have.
 */
import { pool, jsonParse } from '../db/index.js';
import { canonicalGenres } from './genres.js';
import { daysBetween, mean, percentile, round } from '../lib/util.js';

/** How much history a market has, in plain language the UI can show verbatim. */
export type SampleDepth = 'insufficient' | 'low' | 'moderate' | 'high';

export interface TrackObservation {
  capturedAt: string;
  rank: number;
  source: string;
}

export interface TrackSeries {
  trackKey: string;
  market: string;
  title: string;
  artist: string | null;
  observations: TrackObservation[];
  firstSeen: string;
  lastSeen: string;
  rankFirst: number;
  rankLatest: number;
  bestRank: number;
  /** Rank positions gained per day (positive = climbing toward #1). */
  velocity: number;
  /** Distinct collection passes the track appeared in. */
  passes: number;
  /** Share of the market's collection passes in which this track appeared. */
  persistence: number;
  canonicalGenres: string[];
}

export interface MarketHistoryDepth {
  market: string;
  /** Distinct collection passes observed. */
  passes: number;
  distinctDays: number;
  firstCapture: string | null;
  lastCapture: string | null;
  /** Distinct track keys seen. */
  tracks: number;
  depth: SampleDepth;
  /** Days of history still required before rank velocity is meaningful. */
  daysUntilUseful: number;
}

export interface GenrePoint {
  capturedAt: string;
  tracks: number;
  shares: Record<string, number>;
}

interface ObservationRow {
  track_key: string;
  title: string;
  artist: string | null;
  captured_at: string;
  rank: number;
  source: string;
  canonical_genres: string | null;
}

/**
 * Maps sample counts onto a coarse depth label.
 *
 * Two distinct *days* are the minimum for a derivative: several passes inside one
 * day measure intraday churn, not a trend, and reporting velocity from them would
 * overstate what we know.
 */
export function depthFrom(passes: number, distinctDays: number): SampleDepth {
  if (distinctDays < 2 || passes < 2) return 'insufficient';
  if (distinctDays < 5) return 'low';
  if (distinctDays < 15) return 'moderate';
  return 'high';
}

export function marketDepth(market: string): MarketHistoryDepth {
  const { rows } = pool.query<{ captured_at: string; tracks: number }>(
    `SELECT snap.captured_at AS captured_at, COUNT(DISTINCT s.track_key) AS tracks
     FROM signals s
     JOIN signal_snapshots snap ON snap.id = s.snapshot_id
     WHERE s.market = ? AND snap.error IS NULL AND s.track_key IS NOT NULL
     GROUP BY snap.captured_at
     ORDER BY snap.captured_at ASC`,
    [market],
  );

  if (rows.length === 0) {
    return {
      market,
      passes: 0,
      distinctDays: 0,
      firstCapture: null,
      lastCapture: null,
      tracks: 0,
      depth: 'insufficient',
      daysUntilUseful: 7,
    };
  }

  const days = new Set(rows.map((row) => row.captured_at.slice(0, 10)));
  const first = rows[0].captured_at;
  const last = rows[rows.length - 1].captured_at;
  const elapsed = daysBetween(first, last);
  const depth = depthFrom(rows.length, days.size);

  return {
    market,
    passes: rows.length,
    distinctDays: days.size,
    firstCapture: first,
    lastCapture: last,
    tracks: rows.reduce((max, row) => Math.max(max, row.tracks), 0),
    depth,
    // Report the shortfall in whole days so the UI can say "6 more days".
    daysUntilUseful: depth === 'insufficient' ? Math.max(0, Math.ceil(7 - elapsed)) : 0,
  };
}

/**
 * Per-track rank series for a market.
 *
 * Multiple sources charting the same track in one pass are collapsed with
 * MIN(rank): the track's best position in that pass is its presence, and keeping
 * both rows would double-count it in every later aggregate.
 */
export function trackSeries(market: string, limit = 60): TrackSeries[] {
  const { rows } = pool.query<ObservationRow>(
    `SELECT s.track_key AS track_key,
            MAX(s.title) AS title,
            MAX(s.artist) AS artist,
            snap.captured_at AS captured_at,
            MIN(s.rank) AS rank,
            MAX(s.source) AS source,
            MAX(s.canonical_genres) AS canonical_genres
     FROM signals s
     JOIN signal_snapshots snap ON snap.id = s.snapshot_id
     WHERE s.market = ?
       AND snap.error IS NULL
       AND s.track_key IS NOT NULL
       AND s.rank IS NOT NULL
     GROUP BY s.track_key, snap.captured_at
     ORDER BY s.track_key ASC, snap.captured_at ASC`,
    [market],
  );

  const grouped = new Map<string, TrackSeries>();
  for (const row of rows) {
    const existing = grouped.get(row.track_key);
    const observation: TrackObservation = {
      capturedAt: row.captured_at,
      rank: row.rank,
      source: row.source,
    };
    if (!existing) {
      grouped.set(row.track_key, {
        trackKey: row.track_key,
        market,
        title: row.title,
        artist: row.artist,
        observations: [observation],
        firstSeen: row.captured_at,
        lastSeen: row.captured_at,
        rankFirst: row.rank,
        rankLatest: row.rank,
        bestRank: row.rank,
        velocity: 0,
        passes: 1,
        persistence: 1,
        canonicalGenres: jsonParse<string[]>(row.canonical_genres, []),
      });
      continue;
    }
    existing.observations.push(observation);
    existing.lastSeen = row.captured_at;
    existing.rankLatest = row.rank;
    existing.bestRank = Math.min(existing.bestRank, row.rank);
  }

  const series = Array.from(grouped.values());
  // Denominator for persistence: how many passes this market was actually
  // observed on. Without it, "persistence" would measure nothing.
  const marketPasses = Math.max(1, marketDepth(market).passes);
  for (const item of series) {
    item.passes = item.observations.length;
    const span = daysBetween(item.firstSeen, item.lastSeen);
    // Guard against a zero span: several passes within one day would otherwise
    // divide by ~0 and produce a huge, meaningless velocity.
    item.velocity = span >= 0.25 ? round((item.rankFirst - item.rankLatest) / span, 3) : 0;
    item.persistence = round(item.passes / marketPasses, 3);
  }

  // Most observed first, then strongest climb.
  return series.sort((a, b) => b.passes - a.passes || b.velocity - a.velocity).slice(0, limit);
}

/**
 * Rank-weighted genre mix over time - the input to genre drift forecasting.
 *
 * Rows that were never enriched still contribute: their raw (possibly localized)
 * labels are normalized here rather than being dumped into `other`, otherwise a
 * market's mix would look like it changed shape purely because enrichment ran on
 * a different number of rows that day.
 */
export function genreShareSeries(market: string, maxPoints = 90): GenrePoint[] {
  const { rows } = pool.query<{
    captured_at: string;
    rank: number | null;
    canonical_genres: string | null;
    genres: string | null;
  }>(
    `SELECT snap.captured_at AS captured_at,
            s.rank AS rank,
            s.canonical_genres AS canonical_genres,
            s.genres AS genres
     FROM signals s
     JOIN signal_snapshots snap ON snap.id = s.snapshot_id
     WHERE s.market = ? AND snap.error IS NULL
     ORDER BY snap.captured_at ASC`,
    [market],
  );

  const byPass = new Map<string, { counts: Record<string, number>; tracks: number }>();
  for (const row of rows) {
    const bucket = byPass.get(row.captured_at) ?? { counts: {}, tracks: 0 };
    bucket.tracks += 1;

    const stored = jsonParse<string[]>(row.canonical_genres, []);
    const genres = stored.length > 0 ? stored : canonicalGenres(jsonParse<string[]>(row.genres, []));

    const weight = 1 / Math.sqrt(row.rank && row.rank > 0 ? row.rank : 50);
    for (const genre of genres) bucket.counts[genre] = (bucket.counts[genre] ?? 0) + weight;
    byPass.set(row.captured_at, bucket);
  }

  const points: GenrePoint[] = [];
  for (const [capturedAt, bucket] of byPass) {
    const total = Object.values(bucket.counts).reduce((a, b) => a + b, 0);
    const shares: Record<string, number> = {};
    for (const [genre, value] of Object.entries(bucket.counts)) {
      shares[genre] = total > 0 ? round(value / total, 4) : 0;
    }
    points.push({ capturedAt, tracks: bucket.tracks, shares });
  }

  points.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  return points.slice(-maxPoints);
}

/** Median rank of the observed chart - a compact "how competitive" signal. */
export function medianRank(series: TrackSeries[]): number {
  return round(percentile(series.map((s) => s.rankLatest), 50), 1);
}

/** Mean absolute velocity across tracked series (chart turbulence). */
export function chartTurbulence(series: TrackSeries[]): number {
  return round(mean(series.map((s) => Math.abs(s.velocity))), 3);
}