/**
 * iTunes Search API enrichment (free, no key).
 *
 * Apple's chart feed returns localized genres and no duration; the iTunes lookup
 * endpoint returns the canonical genre classification, track length and release
 * date for the same catalog id. Used to enrich top chart rows so BPM/key/genre
 * analysis has trustworthy inputs.
 */
import { config } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { canonicalGenres } from '../analysis/genres.js';
import { sleep } from '../lib/util.js';

interface ItunesLookupResponse {
  resultCount?: number;
  results?: Array<{
    trackName?: string;
    artistName?: string;
    primaryGenreName?: string;
    trackTimeMillis?: number;
    releaseDate?: string;
    country?: string;
    trackViewUrl?: string;
    collectionName?: string;
  }>;
}

export interface ItunesEnrichment {
  canonicalGenres: string[];
  primaryGenre?: string;
  durationMs?: number;
  releaseDate?: string;
  country?: string;
  collectionName?: string;
}

/**
 * Looks up one Apple catalog id in a storefront.
 * Returns null when the id is not available in that storefront.
 */
export async function enrichFromItunes(
  appleId: string,
  market: string,
): Promise<ItunesEnrichment | null> {
  if (!appleId) return null;
  try {
    const json = await fetchJson<ItunesLookupResponse>(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(appleId)}&country=${market}&entity=song`,
      { timeoutMs: config.collection.timeoutMs, retries: 1 },
    );
    const result = json.results?.[0];
    if (!result) return null;

    const genres = result.primaryGenreName ? [result.primaryGenreName] : [];
    return {
      canonicalGenres: canonicalGenres(genres),
      primaryGenre: result.primaryGenreName,
      durationMs: result.trackTimeMillis,
      releaseDate: result.releaseDate,
      country: result.country,
      collectionName: result.collectionName,
    };
  } catch {
    return null;
  }
}

/**
 * Enriches several ids sequentially with a small delay to stay polite.
 * `market` should be a lowercase storefront code; iTunes uses uppercase but
 * accepts either.
 */
export async function enrichMany(
  ids: Array<{ appleId: string; market: string }>,
  delayMs = 120,
): Promise<Map<string, ItunesEnrichment>> {
  const results = new Map<string, ItunesEnrichment>();
  for (const { appleId, market } of ids) {
    const enrichment = await enrichFromItunes(appleId, market);
    if (enrichment) results.set(appleId, enrichment);
    if (delayMs > 0) await sleep(delayMs);
  }
  return results;
}