/**
 * Pure analytics over collected signals. Kept free of IO so the numbers driving
 * song design are easy to reason about and re-verify.
 */
import { contentTokens, jaccard, mean, normalizeDistribution, round, tokenize, trackKey as sharedTrackKey } from '../lib/util.js';
import type { SignalRow } from '../sources/store.js';

export interface RankedEntity {
  name: string;
  count: number;
  bestRank: number;
  /** Rank-weighted presence across the chart. */
  score: number;
}

export interface MomentumReport {
  /** False on the first collection for a market: there is nothing to diff against. */
  hasBaseline: boolean;
  newEntries: Array<{ title: string; artist: string | null; rank: number | null }>;
  droppedCount: number;
  overlapRatio: number;
  rankGainers: Array<{ title: string; artist: string | null; from: number; to: number }>;
  risingArtists: string[];
}

export function rankWeight(rank: number | null | undefined): number {
  const safeRank = rank && rank > 0 ? rank : 50;
  return 1 / Math.sqrt(safeRank);
}

/** Genre mix weighted by chart position, normalized to sum to 1. */
export function genreWeights(rows: SignalRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const genres = row.canonical_genres.length > 0 ? row.canonical_genres : ['other'];
    for (const genre of genres) {
      counts[genre] = (counts[genre] ?? 0) + rankWeight(row.rank);
    }
  }
  return normalizeDistribution(counts);
}

export function topEntities(rows: SignalRow[], field: 'artist' | 'title', limit = 10): RankedEntity[] {
  const map = new Map<string, RankedEntity>();
  for (const row of rows) {
    const name = (field === 'artist' ? row.artist : row.title)?.trim();
    if (!name) continue;
    const existing = map.get(name);
    const rank = row.rank ?? 999;
    if (existing) {
      existing.count += 1;
      existing.bestRank = Math.min(existing.bestRank, rank);
      existing.score += rankWeight(row.rank);
    } else {
      map.set(name, { name, count: 1, bestRank: rank, score: rankWeight(row.rank) });
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entity) => ({ ...entity, score: round(entity.score, 3) }));
}

/**
 * Frequent non-stopword terms in song titles ("what songs are about").
 * Tokens that only appear inside artist names are excluded, otherwise the list
 * degenerates into a ranking of the artists themselves.
 */
export function topTerms(rows: SignalRow[], limit = 20): Array<{ term: string; count: number }> {
  const artistTokens = new Set(rows.flatMap((row) => contentTokens(row.artist ?? '')));
  const counts = new Map<string, number>();

  for (const row of rows) {
    for (const token of new Set(contentTokens(row.title ?? ''))) {
      if (artistTokens.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

/**
 * Recurring phrases in the chart's own titles ("what this market is singing about").
 *
 * `topTerms` gives single words, which is what a subject is *matched* against; a theme has to read
 * like a phrase, because the lyric writer uses themes to choose what a song is about. So this mines
 * adjacent content-token pairs from the titles, weighted so the top of the chart counts for more
 * than the tail, and keeps only phrases that appear in at least two tracks - a phrase one artist
 * used once is a title, not a theme.
 *
 * Tokens that only appear inside artist names are excluded, for the same reason `topTerms` excludes
 * them: otherwise the list quietly becomes a ranking of the artists.
 *
 * CJK and Hangul titles are tokenised into bigrams already, so their pairs join without a space
 * (an inserted space would not match the title it came from); spaced scripts join with one.
 */
export function chartThemes(rows: SignalRow[], limit = 8): string[] {
  if (rows.length === 0) return [];
  // A phrase has to recur across several tracks to be a theme rather than one artist's title, and
  // "several" has to scale with the sample: 3 of 50 is evidence, 3 of 500 is a coincidence.
  const minimum = Math.max(2, Math.ceil(rows.length * 0.06));
  const artistTokens = new Set(rows.flatMap((row) => contentTokens(row.artist ?? '')));
  const counted = new Map<string, { weight: number; tracks: Set<string> }>();

  for (const row of rows) {
    const tokens = contentTokens(row.title ?? '').filter((token) => !artistTokens.has(token));
    const weight = rankWeight(row.rank);
    const phrases = new Set<string>();
    for (let index = 0; index < tokens.length - 1; index += 1) {
      phrases.add(joinPhrase(tokens[index], tokens[index + 1]));
    }
    // A one-word title still carries a theme when the word recurs.
    if (tokens.length === 1) phrases.add(tokens[0]);

    for (const phrase of phrases) {
      const entry = counted.get(phrase) ?? { weight: 0, tracks: new Set<string>() };
      entry.weight += weight;
      entry.tracks.add(trackKey(row));
      counted.set(phrase, entry);
    }
  }

  const recurring = [...counted.entries()]
    .filter(([, entry]) => entry.tracks.size >= minimum)
    .sort((a, b) => b[1].weight - a[1].weight || b[1].tracks.size - a[1].tracks.size)
    .map(([phrase]) => phrase);
  if (recurring.length > 0) return recurring.slice(0, limit);

  // Nothing recurs: fall back to the sample's own single words rather than returning nothing,
  // because an empty list sends the caller to the static regional table and the lyric stops
  // following the chart at all.
  return topTerms(rows, limit).map((entry) => entry.term);
}

/** True for scripts that delimit words, so their phrase pairs keep their space. */
const SPACED_SCRIPT = /[A-Za-z\u00c0-\u024f\u0400-\u04ff]/;

function joinPhrase(first: string, second: string): string {
  return SPACED_SCRIPT.test(first) && SPACED_SCRIPT.test(second) ? `${first} ${second}` : `${first}${second}`;
}

/**
 * Track identity for momentum diffing.
 *
 * Delegates to the shared normalization (diacritics folded, "feat." stripped,
 * Unicode-aware) so a track that momentum calls "the same song" is also the same
 * song in `analysis/series.ts`. Two different normalizations here would produce a
 * chart that reports a track as both persistent and brand new.
 */
function trackKey(row: Pick<SignalRow, 'title' | 'artist'>): string {
  return sharedTrackKey(row.title, row.artist);
}

/**
 * Compares the current snapshot against the previous one for the same
 * market+source. This is what separates "popular" from "rising".
 */
export function momentum(current: SignalRow[], previous: SignalRow[]): MomentumReport {
  if (previous.length === 0) {
    // First sighting of this market: we have nothing to difference against, and
    // reporting every track as "new" would be a lie dressed up as a trend.
    return {
      hasBaseline: false,
      newEntries: [],
      droppedCount: 0,
      overlapRatio: 0,
      rankGainers: [],
      risingArtists: [],
    };
  }

  const previousByKey = new Map(previous.map((row) => [trackKey(row), row]));
  const currentByKey = new Map(current.map((row) => [trackKey(row), row]));

  const newEntries: MomentumReport['newEntries'] = [];
  const rankGainers: MomentumReport['rankGainers'] = [];
  const risingArtists = new Set<string>();

  for (const row of current) {
    const key = trackKey(row);
    const before = previousByKey.get(key);
    if (!before) {
      newEntries.push({ title: row.title, artist: row.artist, rank: row.rank });
      if (row.artist) risingArtists.add(row.artist);
      continue;
    }
    const beforeRank = before.rank ?? 999;
    const nowRank = row.rank ?? 999;
    if (beforeRank - nowRank >= 5) {
      rankGainers.push({ title: row.title, artist: row.artist, from: beforeRank, to: nowRank });
      if (row.artist) risingArtists.add(row.artist);
    }
  }

  let droppedCount = 0;
  for (const key of previousByKey.keys()) {
    if (!currentByKey.has(key)) droppedCount += 1;
  }

  const overlap = current.filter((row) => previousByKey.has(trackKey(row))).length;

  return {
    hasBaseline: true,
    newEntries,
    droppedCount,
    overlapRatio: current.length > 0 ? round(overlap / current.length, 3) : 0,
    rankGainers,
    risingArtists: Array.from(risingArtists).slice(0, 12),
  };
}

export function durationMedian(rows: SignalRow[], fallbackSeconds = 200): number {
  const durations = rows
    .map((row) => row.duration_ms)
    .filter((value): value is number => Boolean(value && value > 0))
    .map((ms) => ms / 1000);
  if (durations.length === 0) return fallbackSeconds;
  return Math.round(mean(durations));
}

export function bpmSamples(rows: SignalRow[]): number[] {
  return rows.map((row) => row.bpm).filter((value): value is number => Boolean(value && value > 0));
}

/** How similar a candidate style string is to the market's actual chart titles. */
export function titleSimilarity(style: string, rows: SignalRow[]): number {
  const styleTokens = tokenize(style);
  if (styleTokens.length === 0 || rows.length === 0) return 0;
  const sample = rows.slice(0, 25);
  const scores = sample.map((row) => jaccard(styleTokens, [...tokenize(row.title), ...tokenize(row.artist ?? '')]));
  return round(Math.max(...scores, 0), 3);
}