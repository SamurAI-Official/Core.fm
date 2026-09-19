/**
 * Deezer public API (free, no key).
 *
 * Two jobs:
 *  1. `deezerGlobalAdapter`  - worldwide + per-genre charts, stored under market
 *     'global'. Gives a cross-market baseline and genre depth.
 *  2. `lookupBpm(title, artist)` - measured BPM for a chart track, which is what
 *     makes a market's *tempo* profile evidence-based instead of guessed.
 *     Deezer reports 0 for unknown BPM, so 0 is treated as "no data".
 */
import { config } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { canonicalGenres } from '../analysis/genres.js';
import { jaccard, tokenize } from '../lib/util.js';
import type { SignalTrack, SourceAdapter } from './types.js';

interface DeezerChartResponse {
  data?: Array<{
    id?: number;
    title?: string;
    rank?: number;
    position?: number;
    duration?: number;
    bpm?: number;
    artist?: { name?: string };
    album?: { title?: string };
  }>;
}

interface DeezerTrack {
  id?: number;
  title?: string;
  duration?: number;
  bpm?: number;
  gain?: number;
  artist?: { name?: string };
  album?: { title?: string };
  release_date?: string;
}

interface DeezerSearchResponse {
  data?: DeezerTrack[];
}

/** Deezer genre ids used for genre-depth charts (verified reachable). */
export const DEEZER_GENRES: Record<string, number> = {
  pop: 132,
  hip_hop_rap: 116,
  rock: 152,
  electronic_dance: 113,
  r_and_b_soul: 165,
  indie_alt: 85,
  house_techno: 106,
  latin: 466,
  reggae_dancehall: 144,
  afrobeats: 2,
  regional_middle_east: 12,
  regional_east_asia: 16,
  regional_south_asian: 75,
  j_pop: 81,
};

function mapChartRow(
  row: NonNullable<DeezerChartResponse['data']>[number],
  market: string,
  source: string,
  fallbackRank: number,
): SignalTrack {
  return {
    rank: row.position ?? row.rank ?? fallbackRank,
    title: row.title ?? 'Untitled',
    artist: row.artist?.name,
    externalId: row.id !== undefined ? String(row.id) : undefined,
    url: row.id !== undefined ? `https://www.deezer.com/track/${row.id}` : undefined,
    durationMs: row.duration ? row.duration * 1000 : undefined,
    bpm: row.bpm && row.bpm > 0 ? row.bpm : undefined,
    market,
    source,
    raw: row,
  };
}

export const deezerGlobalAdapter: SourceAdapter = {
  id: 'deezer-global',
  label: 'Deezer worldwide chart + genre charts',
  // Worldwide data: collected once per cycle, not per market.
  supports: (market: string) => market === 'global',

  async collect(): Promise<SignalTrack[]> {
    const limit = config.collection.deezerChartSize;
    const opts = { timeoutMs: config.collection.timeoutMs, retries: config.collection.retries };
    const tracks: SignalTrack[] = [];

    const world = await fetchJson<DeezerChartResponse>(
      `https://api.deezer.com/chart/0/tracks?limit=${limit}`,
      opts,
    );
    (world.data ?? []).forEach((row, index) => {
      tracks.push(mapChartRow(row, 'global', 'deezer-global', index + 1));
    });

    // Genre depth: top 10 per genre, failures tolerated individually.
    const genreLimit = Math.min(10, limit);
    for (const [genre, genreId] of Object.entries(DEEZER_GENRES)) {
      try {
        const response = await fetchJson<DeezerChartResponse>(
          `https://api.deezer.com/chart/${genreId}/tracks?limit=${genreLimit}`,
          opts,
        );
        (response.data ?? []).forEach((row, index) => {
          const track = mapChartRow(row, 'global', 'deezer-global', index + 1);
          track.canonicalGenres = [genre];
          track.raw = { ...(row as object), deezer_genre: genre };
          tracks.push(track);
        });
      } catch {
        // Genre id unavailable in this region - skip silently, keep the rest.
      }
    }

    return tracks;
  },
};

/**
 * Deezer's public API has become unreliable for BPM: in practice `bpm` is 0 on
 * most tracks (confirmed against the current API). To avoid spending two HTTP
 * calls per chart row for nothing, lookups shut themselves off after a run of
 * misses. Market tempo then falls back to genre norms, which the brief reports
 * as `tempoSource: 'hinted'` instead of pretending the data was measured.
 */
const BPM_MISS_LIMIT = 12;
let consecutiveMisses = 0;
let bpmDisabled = false;

export function bpmLookupDisabled(): boolean {
  return bpmDisabled;
}

export function resetBpmLookupState(): void {
  consecutiveMisses = 0;
  bpmDisabled = false;
}

/**
 * Looks up a measured BPM for a chart track via Deezer search + track detail.
 * Requires a confident title/artist match so we never score the wrong song.
 */
export async function lookupBpm(
  title: string,
  artist: string | undefined,
  minSimilarity = 0.5,
): Promise<{ bpm: number; deezerId: string } | null> {
  if (!title || bpmDisabled) return null;
  const opts = { timeoutMs: config.collection.timeoutMs, retries: 1 };
  const safeTitle = title.replace(/"/g, '');
  const query = artist
    ? `track:"${safeTitle}" artist:"${artist.replace(/"/g, '')}"`
    : `track:"${safeTitle}"`;

  try {
    const search = await fetchJson<DeezerSearchResponse>(
      `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=3`,
      opts,
    );
    const candidates = search.data ?? [];
    const titleTokens = tokenize(title);
    const artistTokens = tokenize(artist ?? '');

    for (const candidate of candidates) {
      const titleScore = jaccard(titleTokens, tokenize(candidate.title ?? ''));
      const artistScore =
        artistTokens.length > 0 ? jaccard(artistTokens, tokenize(candidate.artist?.name ?? '')) : 1;
      if (titleScore < minSimilarity || (artistTokens.length > 0 && artistScore < 0.3)) continue;

      let bpm = candidate.bpm && candidate.bpm > 0 ? candidate.bpm : 0;
      const deezerId = candidate.id !== undefined ? String(candidate.id) : '';
      if (!bpm && deezerId) {
        const detail = await fetchJson<DeezerTrack>(`https://api.deezer.com/track/${deezerId}`, opts);
        if (detail.bpm && detail.bpm > 0) bpm = detail.bpm;
      }

      if (bpm > 0) {
        consecutiveMisses = 0;
        return { bpm, deezerId };
      }
    }
  } catch {
    // Network hiccup: count it as a miss, never throw during enrichment.
  }

  consecutiveMisses += 1;
  if (consecutiveMisses >= BPM_MISS_LIMIT) {
    bpmDisabled = true;
  }
  return null;
}