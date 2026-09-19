/**
 * Trend forecasting.
 *
 * Method: damped linear extrapolation of the measurements we actually have -
 * rank velocity per track, and rank-weighted genre share drift - with the
 * projection clamped and scaled by how much history backs it.
 *
 * This is deliberately not a learned model. With days of data, a learned
 * forecaster would fit noise and present it as insight; an explicit slope plus a
 * stated confidence can be checked by hand and degrades honestly when the sample
 * is thin ("insufficient history" rather than a confident-looking number).
 */
import { GENRE_TEMPO_HINTS, tempoClass, type TempoClass } from '../analysis/tempo.js';
import {
  chartTurbulence,
  genreShareSeries,
  marketDepth,
  medianRank,
  trackSeries,
  type MarketHistoryDepth,
  type SampleDepth,
  type TrackSeries,
} from '../analysis/series.js';
import { clamp, round } from '../lib/util.js';

export interface TrackForecast {
  trackKey: string;
  title: string;
  artist: string | null;
  market: string;
  currentRank: number;
  projectedRank: number;
  /** Expected rank positions gained over the horizon (positive = improving). */
  expectedGain: number;
  velocityPerDay: number;
  /** Share of consecutive observations moving with the trend (0..1). */
  consistency: number;
  confidence: number;
  rationale: string;
}

export interface GenreForecast {
  genre: string;
  currentShare: number;
  projectedShare: number;
  /** Share change per day. */
  driftPerDay: number;
  direction: 'rising' | 'cooling' | 'stable';
  confidence: number;
}

export interface MarketForecast {
  market: string;
  horizonDays: number;
  depth: SampleDepth;
  history: MarketHistoryDepth;
  /** Plain-language statement of what this forecast cannot know yet. */
  caveat: string | null;
  risingTracks: TrackForecast[];
  genreForecast: GenreForecast[];
  tempoProjection: { bpm: number; tempoClass: TempoClass; confidence: number } | null;
  competitiveness: { medianRank: number; turbulence: number };
  generatedAt: string;
}

export interface ForecastOptions {
  horizonDays?: number;
  /** Minimum expected gain for a track to count as "rising". */
  minGain?: number;
  limit?: number;
}

/** Confidence ceiling per depth: thin history can never yield a strong claim. */
const DEPTH_CONFIDENCE: Record<SampleDepth, number> = {
  insufficient: 0.05,
  low: 0.3,
  moderate: 0.55,
  high: 0.8,
};

/** How much of the observed per-day movement we credit at each depth. */
const DEPTH_DAMPING: Record<SampleDepth, number> = {
  insufficient: 0.15,
  low: 0.5,
  moderate: 0.75,
  high: 1,
};

/** Ordinary least-squares slope of y over x (0 when degenerate). */
function leastSquaresSlope(points: Array<{ x: number; y: number }>): number {
  if (points.length < 2) return 0;
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Share of consecutive steps that moved in the trend's direction.
 *
 * A single large jump and a steady climb can share a slope; this separates them,
 * and is why a track with one spike is reported with lower confidence than one
 * that has been gaining every pass.
 */
function movementConsistency(series: TrackSeries): number {
  const ranks = series.observations.map((o) => o.rank);
  if (ranks.length < 3) return 0.5;
  const improving = ranks[0] > ranks[ranks.length - 1];
  let matching = 0;
  let steps = 0;
  for (let i = 1; i < ranks.length; i += 1) {
    if (ranks[i] === ranks[i - 1]) continue;
    steps += 1;
    if (improving ? ranks[i] < ranks[i - 1] : ranks[i] > ranks[i - 1]) matching += 1;
  }
  return steps === 0 ? 0.5 : round(matching / steps, 3);
}

/** Epoch ms for either an ISO string or SQLite's `YYYY-MM-DD HH:MM:SS` form. */
function toMs(iso: string): number {
  return Date.parse(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
}

/**
 * Projects each tracked track's rank over the horizon.
 *
 * Tracks seen only once are skipped outright: a single observation has a
 * position but no direction, and treating it as flat would pad the list with
 * non-signals.
 */
function forecastTracks(
  market: string,
  horizonDays: number,
  depth: SampleDepth,
  minGain: number,
  limit: number,
): TrackForecast[] {
  const damping = DEPTH_DAMPING[depth];
  const baseConfidence = DEPTH_CONFIDENCE[depth];
  const forecasts: TrackForecast[] = [];

  for (const item of trackSeries(market, 150)) {
    if (item.passes < 2) continue;

    const consistency = movementConsistency(item);
    // Physical bounds, not statistical ones: a track cannot climb past #1, and a
    // one-week projection should not claim it will lose more than half its
    // current position.
    const maxGain = Math.max(0, (item.rankLatest - 1) * 0.6);
    const minGainAllowed = -(item.rankLatest * 0.5);
    const expectedGain = round(
      clamp(item.velocity * horizonDays * damping, minGainAllowed, maxGain),
      2,
    );
    if (expectedGain < minGain) continue;

    const confidence = round(
      baseConfidence * (0.5 + 0.5 * item.persistence) * (0.6 + 0.4 * consistency),
      3,
    );
    const projectedRank = Math.max(1, Math.round(item.rankLatest - expectedGain));

    forecasts.push({
      trackKey: item.trackKey,
      title: item.title,
      artist: item.artist,
      market,
      currentRank: item.rankLatest,
      projectedRank,
      expectedGain,
      velocityPerDay: item.velocity,
      consistency,
      confidence,
      rationale:
        `#${item.rankLatest} -> #${projectedRank} over ${horizonDays}d ` +
        `(${item.velocity >= 0 ? '+' : ''}${item.velocity}/day, credited ${damping}x for ${depth} history, ` +
        `persistence ${Math.round(item.persistence * 100)}%, consistency ${Math.round(consistency * 100)}%)`,
    });
  }

  return forecasts
    .sort((a, b) => b.confidence - a.confidence || b.expectedGain - a.expectedGain)
    .slice(0, limit);
}

/**
 * Projects genre share drift.
 *
 * A genre absent from a pass counts as share 0 rather than being skipped, so the
 * fitted line reflects the genre entering and leaving the chart instead of only
 * the passes where it happened to appear.
 */
function forecastGenres(market: string, horizonDays: number, depth: SampleDepth): GenreForecast[] {
  const points = genreShareSeries(market);
  if (points.length < 2) return [];

  const start = toMs(points[0].capturedAt);
  const genres = new Set<string>();
  for (const point of points) for (const genre of Object.keys(point.shares)) genres.add(genre);

  const baseConfidence = DEPTH_CONFIDENCE[depth];
  const out: GenreForecast[] = [];

  for (const genre of genres) {
    const samples = points.map((point) => ({
      x: (toMs(point.capturedAt) - start) / 86_400_000,
      y: point.shares[genre] ?? 0,
    }));

    const currentShare = samples[samples.length - 1].y;
    const driftPerDay = leastSquaresSlope(samples);
    // Damped exactly like track velocity: with one day of intraday churn, the
    // fitted slope is mostly noise, and projecting it undamped produced shares
    // climbing from 38% to 97% in a week - a number no one should act on.
    const projectedShare = round(
      clamp(currentShare + driftPerDay * horizonDays * DEPTH_DAMPING[depth], 0, 1),
      4,
    );
    // Ignore genres that are and remain negligible - they are noise, not trends.
    if (Math.max(currentShare, projectedShare) < 0.02) continue;

    const presence = samples.filter((sample) => sample.y > 0).length / samples.length;
    const confidence = round(
      baseConfidence *
        (points.length >= 3 ? 1 : 0.6) *
        (0.5 + 0.5 * presence) *
        (currentShare > 0.05 ? 1 : 0.6),
      3,
    );

    out.push({
      genre,
      currentShare,
      projectedShare,
      driftPerDay: round(driftPerDay, 5),
      direction: driftPerDay > 0.002 ? 'rising' : driftPerDay < -0.002 ? 'cooling' : 'stable',
      confidence,
    });
  }

  return out.sort((a, b) => b.projectedShare - a.projectedShare).slice(0, 12);
}

/** Weighted tempo implied by the projected genre mix (genre norms, not audio). */
function projectTempo(genres: GenreForecast[]): MarketForecast['tempoProjection'] {
  let weightedBpm = 0;
  let weightedConfidence = 0;
  let weight = 0;

  for (const genre of genres) {
    const hint = GENRE_TEMPO_HINTS[genre.genre];
    if (!hint) continue;
    weightedBpm += hint.typical * genre.projectedShare;
    // Share-weighted average of the genres' own confidences. Mixing BPM into the
    // confidence term (as an earlier version did) made the result depend on the
    // unit scale rather than on how well-supported the inputs are.
    weightedConfidence += genre.projectedShare * genre.confidence;
    weight += genre.projectedShare;
  }
  if (weight <= 0) return null;

  const bpm = Math.round(weightedBpm / weight);
  return {
    bpm,
    tempoClass: tempoClass(bpm),
    confidence: round(weightedConfidence / weight, 3),
  };
}

/**
 * Builds the forward-looking view of one market.
 *
 * Read the `caveat` first, not the numbers: with one or two collection passes the
 * projections below are extrapolations of intraday churn, and the caveat says so
 * instead of letting a confident-looking percentage imply otherwise.
 */
export function forecastMarket(market: string, options: ForecastOptions = {}): MarketForecast {
  const horizonDays = options.horizonDays ?? 7;
  const minGain = options.minGain ?? 0.5;
  const limit = options.limit ?? 10;

  const history = marketDepth(market);
  const series = trackSeries(market, 150);
  const genreForecast = forecastGenres(market, horizonDays, history.depth);

  let caveat: string | null = null;
  if (history.depth === 'insufficient') {
    const parts = [
      `Only ${history.passes} collection pass(es) across ${history.distinctDays} day(s) for ${market}`,
      'so rank velocity and genre drift are not yet meaningful',
    ];
    if (history.daysUntilUseful > 0) parts.push(`about ${history.daysUntilUseful} more day(s) of collection needed`);
    caveat = `${parts.join('; ')}.`;
  }

  return {
    market,
    horizonDays,
    depth: history.depth,
    history,
    caveat,
    risingTracks: forecastTracks(market, horizonDays, history.depth, minGain, limit),
    genreForecast,
    tempoProjection: projectTempo(genreForecast),
    competitiveness: {
      medianRank: medianRank(series),
      turbulence: chartTurbulence(series),
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Forecasts every requested market, cheapest-first (fewest passes first). */
export function forecastMarkets(markets: string[], options: ForecastOptions = {}): MarketForecast[] {
  return markets.map((market) => forecastMarket(market, options));
}

/**
 * The single most actionable genre bet for a market, if one exists.
 *
 * Returns null when nothing is confidently rising - a design cycle should be able
 * to say "no signal yet" rather than being forced to pick the top of a noisy list.
 */
export function bestGenreBet(forecast: MarketForecast, minConfidence = 0.15): GenreForecast | null {
  const candidates = forecast.genreForecast
    .filter((genre) => genre.direction === 'rising' && genre.confidence >= minConfidence)
    .sort((a, b) => b.driftPerDay * b.confidence - a.driftPerDay * a.confidence);
  return candidates[0] ?? null;
}

export function describeForecast(forecast: MarketForecast): string {
  if (forecast.caveat) return `${forecast.market.toUpperCase()}: ${forecast.caveat}`;
  const bet = bestGenreBet(forecast);
  const tempo = forecast.tempoProjection
    ? `, tempo heading to ~${forecast.tempoProjection.bpm} BPM (${forecast.tempoProjection.tempoClass})`
    : '';
  const betText = bet
    ? `${bet.genre} rising ${(bet.driftPerDay * 100).toFixed(2)}pp/day (confidence ${bet.confidence})`
    : 'no genre confidently rising';
  return `${forecast.market.toUpperCase()} (${forecast.depth} history, ${forecast.horizonDays}d horizon): ${betText}${tempo}`;
}