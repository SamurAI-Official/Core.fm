/**
 * Shared contract for signal sources.
 *
 * A source adapter turns one public endpoint (or a family of them) into
 * `SignalTrack[]` for a given market. Adapters must never throw for a single bad
 * market: collection failures are reported as `SourceOutcome.error` so a cycle
 * can continue with the sources that did respond.
 */

export interface SignalTrack {
  /** 1-based position in the chart, when the source is rank ordered. */
  rank?: number;
  title: string;
  artist?: string;
  /** Source specific identifier (Apple catalog id, Deezer id, ...). */
  externalId?: string;
  url?: string;
  /** Raw genre labels exactly as published (may be localized). */
  genres?: string[];
  canonicalGenres?: string[];
  durationMs?: number;
  releaseDate?: string;
  /** Measured BPM when available. */
  bpm?: number;
  /** Market this signal belongs to ('global' for worldwide feeds). */
  market: string;
  source: string;
  raw?: unknown;
}

export interface SourceAdapter {
  /** Stable id stored in `signals.source`. */
  id: string;
  label: string;
  /** Optional market filter (e.g. Spotify Top-50 only covers certain countries). */
  supports?: (market: string) => boolean;
  collect(market: string): Promise<SignalTrack[]>;
}

export interface SourceOutcome {
  source: string;
  market: string;
  count: number;
  durationMs: number;
  error?: string;
  /** Number of tracks enriched with canonical genre / BPM. */
  enriched?: number;
}

export function outcome(
  source: string,
  market: string,
  count: number,
  durationMs: number,
  error?: string,
  enriched?: number,
): SourceOutcome {
  return { source, market, count, durationMs, error, enriched };
}