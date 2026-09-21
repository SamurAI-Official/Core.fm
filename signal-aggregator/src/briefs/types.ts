/**
 * Market brief types and the deterministic narrative/description helpers.
 */
import type { TempoProfile } from '../analysis/tempo.js';
import type { MomentumReport, RankedEntity } from '../analysis/metrics.js';

export interface MarketBrief {
  id: string;
  market: string;
  marketName: string;
  createdAt: string;
  trackCount: number;
  genreWeights: Record<string, number>;
  momentum: MomentumReport;
  bpm: TempoProfile;
  /** 'measured' when real BPM data backed the profile, 'hinted' when genre-based. */
  tempoSource: 'measured' | 'blended' | 'hinted';
  /** Tempo norms for the market's leading genres (used when measurements are thin). */
  genreBpmHints: Record<string, { min: number; max: number; typical: number }>;
  /** Key mix. Empty until the learning loop earns key preferences from ratings. */
  keyWeights: Record<string, number>;
  durationMedian: number;
  languages: string[];
  topArtists: RankedEntity[];
  topTerms: Array<{ term: string; count: number }>;
  /**
   * Recurring title phrases mined from this brief's own sample (`chartThemes`).
   *
   * The lyric writer uses these to choose what a song is about, so they come from the collected
   * signals rather than from the static regional table in `marketFlavor.ts` - that table is only the
   * fallback for a market whose sample is too thin to have recurring phrasing.
   */
  themes: string[];
  summary: string;
  sources: string[];
}

export function describeTempo(bpm: TempoProfile, source: MarketBrief['tempoSource']): string {
  if (source === 'measured') {
    return `tempo ${bpm.tempoClass} (measured median ${bpm.median} BPM, IQR ${bpm.p25}-${bpm.p75}, n=${bpm.sampleSize})`;
  }
  if (source === 'blended') {
    return `tempo ${bpm.tempoClass} (median ${bpm.median} BPM blended from ${bpm.sampleSize} measurements + genre norms)`;
  }
  return `tempo ${bpm.tempoClass} (${bpm.median} BPM from genre norms; too few chart BPM readings)`;
}

export function topGenres(weights: Record<string, number>, limit = 4): string {
  return Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([genre, weight]) => `${genre} ${Math.round(weight * 100)}%`)
    .join(', ');
}

export function buildSummary(
  market: string,
  label: string,
  weights: Record<string, number>,
  bpm: TempoProfile,
  source: MarketBrief['tempoSource'],
  move: MomentumReport,
  artists: RankedEntity[],
  terms: Array<{ term: string; count: number }>,
  duration: number,
): string {
  const parts = [
    `${label} (${market}): top genres ${topGenres(weights) || 'unknown'}`,
    describeTempo(bpm, source),
    `typical length ${duration}s`,
  ];
  if (move.hasBaseline) {
    parts.push(
      `${move.newEntries.length} new entries and ${move.droppedCount} drops vs. previous snapshot (overlap ${Math.round(move.overlapRatio * 100)}%)`,
    );
  } else {
    parts.push('baseline snapshot (momentum appears after the next collection)');
  }
  if (artists.length > 0) parts.push(`chart leaders ${artists.slice(0, 3).map((a) => a.name).join(', ')}`);
  if (terms.length > 0) parts.push(`recurring themes: ${terms.slice(0, 6).map((t) => t.term).join(', ')}`);
  return `${parts.join('; ')}.`;
}