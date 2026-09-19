/**
 * Apple Music "most played" chart per storefront country.
 *
 * This is the primary nation-level popularity signal: genuinely free, no API key,
 * one call per country, and it returns localized genre labels (which is exactly
 * what the genre normalizer exists to unify).
 *
 *   GET https://rss.applemarketingtools.com/api/v2/{cc}/music/most-played/{n}/songs.json
 */
import { config } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { canonicalGenres } from '../analysis/genres.js';
import type { SignalTrack, SourceAdapter } from './types.js';

interface AppleFeed {
  feed?: {
    updated?: string;
    results?: Array<{
      artistName?: string;
      id?: string;
      name?: string;
      releaseDate?: string;
      url?: string;
      genres?: Array<{ name?: string }>;
    }>;
  };
}

export const appleAdapter: SourceAdapter = {
  id: 'apple-most-played',
  label: 'Apple Music most-played songs (per country)',
  // Apple Music charts are per storefront country; there is no worldwide feed.
  supports: (market: string) => market !== 'global',

  async collect(market: string): Promise<SignalTrack[]> {
    const limit = config.collection.appleChartSize;
    const url = `https://rss.applemarketingtools.com/api/v2/${market}/music/most-played/${limit}/songs.json`;
    const json = await fetchJson<AppleFeed>(url, {
      timeoutMs: config.collection.timeoutMs,
      retries: config.collection.retries,
    });

    const results = json.feed?.results ?? [];
    return results.map((entry, index) => {
      const genres = (entry.genres ?? []).map((g) => g.name).filter((g): g is string => Boolean(g));
      return {
        rank: index + 1,
        title: entry.name ?? 'Untitled',
        artist: entry.artistName,
        externalId: entry.id,
        url: entry.url,
        genres,
        canonicalGenres: canonicalGenres(genres),
        releaseDate: entry.releaseDate,
        market,
        source: 'apple-most-played',
        raw: entry,
      };
    });
  },
};