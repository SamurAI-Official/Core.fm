/**
 * Tempo and key analysis.
 *
 * Tempo comes from real measurements (Deezer's track endpoint exposes BPM), so
 * market tempo profiles are evidence-based. Key signatures are NOT available from
 * these public feeds, so keys are treated as a genuinely unknown dimension:
 * `keyWeights` stays empty until the learning loop earns key preferences from
 * human ratings (`market_weights`), and design falls back to genre hints.
 */
import { clamp, mean, median, percentile, round } from '../lib/util.js';

export type TempoClass = 'slow' | 'midtempo' | 'uptempo' | 'fast' | 'unknown';

export const TEMPO_CLASSES: TempoClass[] = ['slow', 'midtempo', 'uptempo', 'fast'];

export interface TempoProfile {
  median: number;
  p25: number;
  p75: number;
  tempoClass: TempoClass;
  sampleSize: number;
}

/** Inclusive BPM bands used for a human-readable read on each market. */
export function tempoClass(bpm: number | null | undefined): TempoClass {
  if (!bpm || bpm <= 0) return 'unknown';
  if (bpm < 90) return 'slow';
  if (bpm < 120) return 'midtempo';
  if (bpm < 140) return 'uptempo';
  return 'fast';
}

export function summarizeTempo(bpms: number[]): TempoProfile {
  const clean = bpms.filter((b) => Number.isFinite(b) && b > 0);
  if (clean.length === 0) {
    return { median: 0, p25: 0, p75: 0, tempoClass: 'unknown', sampleSize: 0 };
  }
  const med = Math.round(median(clean));
  return {
    median: med,
    p25: Math.round(percentile(clean, 25)),
    p75: Math.round(percentile(clean, 75)),
    tempoClass: tempoClass(med),
    sampleSize: clean.length,
  };
}

/**
 * Fallback tempo ranges per canonical genre, used only when a market's own BPM
 * sample is too small to trust (e.g. a market whose chart returned < 5 readings).
 */
export const GENRE_TEMPO_HINTS: Record<string, { min: number; max: number; typical: number }> = {
  pop: { min: 100, max: 124, typical: 116 },
  hip_hop_rap: { min: 80, max: 104, typical: 92 },
  trap: { min: 130, max: 160, typical: 140 },
  r_and_b_soul: { min: 70, max: 100, typical: 88 },
  rock: { min: 110, max: 150, typical: 128 },
  metal: { min: 130, max: 180, typical: 150 },
  punk: { min: 150, max: 190, typical: 168 },
  indie_alt: { min: 100, max: 138, typical: 120 },
  electronic_dance: { min: 120, max: 132, typical: 126 },
  house_techno: { min: 122, max: 132, typical: 126 },
  ambient_chill: { min: 60, max: 95, typical: 80 },
  latin: { min: 88, max: 110, typical: 96 },
  reggaeton: { min: 88, max: 98, typical: 92 },
  country: { min: 90, max: 130, typical: 110 },
  folk_americana: { min: 80, max: 120, typical: 100 },
  jazz: { min: 80, max: 160, typical: 110 },
  blues: { min: 70, max: 130, typical: 100 },
  classical: { min: 60, max: 120, typical: 90 },
  soundtrack: { min: 60, max: 140, typical: 100 },
  k_pop: { min: 100, max: 130, typical: 118 },
  j_pop: { min: 110, max: 140, typical: 124 },
  city_pop: { min: 95, max: 120, typical: 108 },
  anime_vocaloid: { min: 120, max: 180, typical: 145 },
  afrobeats: { min: 98, max: 115, typical: 106 },
  amapiano: { min: 108, max: 118, typical: 112 },
  reggae_dancehall: { min: 70, max: 105, typical: 92 },
  soul_funk: { min: 95, max: 125, typical: 108 },
  gospel_christian: { min: 70, max: 110, typical: 92 },
  devotional: { min: 60, max: 100, typical: 80 },
  regional_south_asian: { min: 85, max: 130, typical: 105 },
  regional_latin: { min: 85, max: 135, typical: 100 },
  regional_middle_east: { min: 80, max: 130, typical: 100 },
  regional_east_asia: { min: 85, max: 130, typical: 105 },
  regional_europe: { min: 90, max: 130, typical: 112 },
  singer_songwriter: { min: 70, max: 115, typical: 95 },
  holiday: { min: 90, max: 130, typical: 112 },
  kids_family: { min: 100, max: 140, typical: 120 },
  instrumental_newage: { min: 60, max: 100, typical: 80 },
  other: { min: 90, max: 130, typical: 110 },
};

/** Keeps a BPM inside an ACE-Step friendly window and near a market target. */
export function clampBpm(target: number, min = 60, max = 180): number {
  const safe = Number.isFinite(target) && target > 0 ? Math.round(target) : 110;
  return Math.min(max, Math.max(min, safe));
}

/** Mean BPM of trusted measurements, or 0 when the sample is too small. */
export function trustedBpm(bpms: number[], minimumSample = 5): number {
  const clean = bpms.filter((b) => Number.isFinite(b) && b > 0);
  if (clean.length < minimumSample) return 0;
  return round(mean(clean), 1);
}

/** Average BPM of chart entries, weighting rank so #1 counts most. */
export function weightedChartBpm(entries: Array<{ bpm?: number | null; rank?: number | null }>): number {
  const weighted: Array<{ value: number; weight: number }> = [];
  for (const entry of entries) {
    if (!entry.bpm || entry.bpm <= 0) continue;
    const rank = entry.rank && entry.rank > 0 ? entry.rank : 50;
    weighted.push({ value: entry.bpm, weight: 1 / Math.sqrt(rank) });
  }
  if (weighted.length === 0) return 0;
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  return round(weighted.reduce((sum, w) => sum + w.value * w.weight, 0) / totalWeight, 1);
}
/**
 * Genre-typical key hints (used only until the loop learns market key
 * preferences from human ratings).
 */
export const GENRE_KEY_HINTS: Record<string, string[]> = {
  pop: ['C major', 'G major', 'A minor', 'D major'],
  hip_hop_rap: ['F minor', 'G minor', 'A minor', 'D minor'],
  trap: ['F minor', 'C minor', 'G minor'],
  r_and_b_soul: ['D major', 'E minor', 'B minor'],
  rock: ['E minor', 'A minor', 'D major', 'G major'],
  metal: ['E minor', 'D minor', 'B minor'],
  punk: ['A major', 'E major', 'D major'],
  indie_alt: ['D major', 'G major', 'B minor'],
  electronic_dance: ['A minor', 'F minor', 'C minor'],
  house_techno: ['A minor', 'G minor', 'F minor'],
  ambient_chill: ['C major', 'D major', 'A minor'],
  latin: ['A minor', 'D minor', 'G major'],
  reggaeton: ['A minor', 'F minor', 'G minor'],
  country: ['G major', 'D major', 'A major'],
  folk_americana: ['G major', 'C major', 'D major'],
  jazz: ['Bb major', 'F major', 'C minor'],
  blues: ['A minor', 'E minor', 'G major'],
  classical: ['C major', 'D minor', 'G minor'],
  soundtrack: ['D minor', 'C major', 'A minor'],
  k_pop: ['A minor', 'C major', 'F major'],
  j_pop: ['D major', 'A major', 'B minor'],
  city_pop: ['F major', 'C major', 'A minor'],
  anime_vocaloid: ['A minor', 'E minor', 'D major'],
  afrobeats: ['F minor', 'A minor', 'C major'],
  amapiano: ['A minor', 'D minor', 'F minor'],
  reggae_dancehall: ['A minor', 'G major', 'C major'],
  soul_funk: ['Eb major', 'F minor', 'Bb major'],
  gospel_christian: ['C major', 'F major', 'G major'],
  devotional: ['C major', 'D minor', 'G major'],
  regional_south_asian: ['D minor', 'A minor', 'C major'],
  regional_latin: ['A minor', 'D minor', 'G major'],
  regional_middle_east: ['D minor', 'A minor', 'G minor'],
  regional_east_asia: ['A minor', 'C major', 'D major'],
  regional_europe: ['C major', 'G major', 'A minor'],
  singer_songwriter: ['G major', 'C major', 'D major'],
  holiday: ['C major', 'F major', 'G major'],
  kids_family: ['C major', 'F major', 'G major'],
  instrumental_newage: ['C major', 'D major', 'A minor'],
  other: ['C major', 'A minor', 'G major'],
};

/**
 * Suggests keys for the genres a market favours.
 * `learned` entries (from market_weights) take precedence over genre hints.
 */
export function suggestKeys(
  genreWeights: Record<string, number>,
  learned: Array<[string, number]> = [],
): string[] {
  const ranked: Array<[string, number]> = [];
  const bump = (key: string, score: number): void => {
    const existing = ranked.find(([k]) => k === key);
    if (existing) existing[1] += score;
    else ranked.push([key, score]);
  };

  for (const [genre, weight] of Object.entries(genreWeights)) {
    const hints = GENRE_KEY_HINTS[genre] ?? GENRE_KEY_HINTS.other;
    hints.forEach((key, index) => bump(key, weight * (1 - index * 0.25)));
  }
  for (const [key, value] of learned) bump(key, clamp(value, 0, 3) * 0.5);

  return ranked
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)
    .slice(0, 8);
}