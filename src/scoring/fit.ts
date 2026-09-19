/**
 * Market-fit components. Each function returns an explainable 0..1 score with a
 * note that is stored in the run's breakdown, so a weak result can be traced to a
 * specific mismatch instead of a single opaque number.
 */
import { config } from '../config.js';
import { clamp, round } from '../lib/util.js';
import { titleSimilarity } from '../analysis/metrics.js';
import { latestSignals } from '../sources/store.js';
import type { MarketBrief } from '../briefs/types.js';
import type { Concept } from '../design/types.js';

export interface FitComponent {
  score: number;
  note: string;
}

/** Relative importance of each fit component when computing market fit. */
export const COMPONENT_WEIGHTS = {
  bpm: 0.3,
  genre: 0.35,
  key: 0.12,
  duration: 0.13,
  language: 0.1,
} as const;

export function bpmFit(actual: number | null, target: number): FitComponent {
  if (!actual || actual <= 0) return { score: 0.5, note: 'bpm unknown -> neutral 0.5' };
  if (!target || target <= 0) return { score: 0.6, note: 'no market bpm target -> 0.6' };
  const distance = Math.abs(actual - target);
  const score = clamp(1 - distance / 30);
  return { score, note: `bpm ${actual} vs market target ${target} (delta ${distance}) -> ${round(score)}` };
}

export function genreFit(primaryGenre: string, brief: MarketBrief): FitComponent {
  const share = brief.genreWeights[primaryGenre] ?? 0;
  return {
    score: clamp(share * 3),
    note: `genre ${primaryGenre} holds ${Math.round(share * 100)}% weighted chart share`,
  };
}

export function keyFit(concept: Concept, brief: MarketBrief): FitComponent {
  const keys = Object.keys(brief.keyWeights);
  if (keys.length === 0) return { score: 0.6, note: 'no market key data yet -> neutral 0.6' };
  const weight = brief.keyWeights[concept.keyScale] ?? 0;
  const maxWeight = Math.max(...Object.values(brief.keyWeights), 0.0001);
  return {
    score: clamp(weight / maxWeight),
    note: `key ${concept.keyScale} preference ${round(weight / maxWeight)}`,
  };
}

export function durationFit(concept: Concept, brief: MarketBrief): FitComponent {
  const target = brief.durationMedian || config.design.duration;
  const distance = Math.abs(concept.duration - target);
  return {
    score: clamp(1 - distance / 90),
    note: `duration ${concept.duration}s vs market typical ${target}s`,
  };
}

export function languageFit(concept: Concept, brief: MarketBrief): FitComponent {
  const match = brief.languages.includes(concept.vocalLanguage);
  return {
    score: match ? 1 : 0.7,
    note: match
      ? `vocal language ${concept.vocalLanguage} matches market`
      : `vocal language ${concept.vocalLanguage} not in market languages (${brief.languages.join('/')})`,
  };
}

/**
 * Freshness versus what already charts.
 * A little familiarity is good: both copying the chart and going fully alien
 * score lower than landing near a modest overlap.
 */
export function noveltyFit(concept: Concept, market: string): FitComponent {
  const rows = latestSignals(market, 60);
  const similarity = titleSimilarity(`${concept.style} ${concept.title}`, rows);
  const score = clamp(1 - Math.abs(similarity - 0.25) / 0.4);
  return { score, note: `overlap with current chart ${similarity} -> novelty ${round(score)}` };
}