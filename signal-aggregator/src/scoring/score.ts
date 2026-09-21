/**
 * Scoring and learning.
 *
 * Two tiers:
 *  1. proxy score (always available) - how well a concept matches the market's
 *     brief, and how fresh it is versus the current chart.
 *  2. composite score - once a human/panel rating exists, proxy components are
 *     blended with that rating using the configured weights.
 *
 * Learning is driven by human ratings only. A model grading its own output is not
 * evidence that a market liked a song, so proxy scores never move the weights.
 */
import { config } from '../config.js';
import { clamp, round } from '../lib/util.js';
import { learnFromFeedback, type FeedbackVerdict } from './feedback.js';
import type { MarketBrief } from '../briefs/types.js';
import type { Concept } from '../design/types.js';
import type { RunRecord } from '../loops/store.js';
import {
  COMPONENT_WEIGHTS,
  bpmFit,
  durationFit,
  genreFit,
  keyFit,
  languageFit,
  noveltyFit,
} from './fit.js';

export type Verdict = 'champion' | 'viable' | 'weak' | 'unrated' | 'failed';

export interface ScoreBreakdown {
  components: Record<string, number>;
  notes: string[];
  weights: Record<string, number>;
}

export interface ScoreInput {
  run: RunRecord;
  concept: Concept;
  brief: MarketBrief;
  engineScore?: number | null;
}

export interface ScoreResult {
  marketFit: number;
  novelty: number;
  composite: number;
  verdict: Verdict;
  breakdown: ScoreBreakdown;
}

/** Blends available signals, renormalising so partial data cannot skew the result. */
function blend(parts: Array<[number, number]>): number {
  const totalWeight = parts.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  return clamp(parts.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight);
}

export function scoreRun(input: ScoreInput): ScoreResult {
  const { run, concept, brief } = input;
  const notes: string[] = [];
  const components: Record<string, number> = {};

  const bpm = bpmFit(run.reportedBpm ?? concept.bpm, brief.bpm.median);
  const genre = genreFit(concept.primaryGenre, brief);
  const key = keyFit(concept, brief);
  const duration = durationFit(concept, brief);
  const language = languageFit(concept, brief);
  const novelty = noveltyFit(concept, brief.market);

  components.bpm = round(bpm.score);
  components.genre = round(genre.score);
  components.key = round(key.score);
  components.duration = round(duration.score);
  components.language = round(language.score);
  notes.push(bpm.note, genre.note, key.note, duration.note, language.note, novelty.note);

  const marketFit = clamp(
    components.bpm * COMPONENT_WEIGHTS.bpm +
      components.genre * COMPONENT_WEIGHTS.genre +
      components.key * COMPONENT_WEIGHTS.key +
      components.duration * COMPONENT_WEIGHTS.duration +
      components.language * COMPONENT_WEIGHTS.language,
  );
  components.marketFit = round(marketFit);
  components.novelty = round(novelty.score);

  const human = run.humanScore;
  const engine = input.engineScore ?? run.engineScore ?? null;

  let composite: number;
  let verdict: Verdict;

  if (human === null || human === undefined) {
    const parts: Array<[number, number]> = [
      [marketFit, config.scoring.weightMarketFit],
      [novelty.score, config.scoring.weightNovelty],
    ];
    if (engine !== null) parts.push([engine, config.scoring.weightHuman * 0.5]);
    composite = blend(parts);
    verdict = 'unrated';
    notes.push('no human rating yet: proxy-only composite (weights renormalised over available signals)');
  } else {
    const parts: Array<[number, number]> = [
      [marketFit, config.scoring.weightMarketFit],
      [novelty.score, config.scoring.weightNovelty],
      [human, config.scoring.weightHuman],
    ];
    if (engine !== null) parts.push([engine, config.scoring.weightHuman * 0.5]);
    composite = blend(parts);
    verdict =
      composite >= config.scoring.championThreshold
        ? 'champion'
        : composite >= config.scoring.viableThreshold
          ? 'viable'
          : 'weak';
    notes.push(`human rating ${round(human)} blended with proxy signals`);
  }

  return {
    marketFit: round(marketFit),
    novelty: round(novelty.score),
    composite: round(composite),
    verdict,
    breakdown: {
      components,
      notes,
      weights: {
        marketFit: config.scoring.weightMarketFit,
        novelty: config.scoring.weightNovelty,
        human: config.scoring.weightHuman,
        champion: config.scoring.championThreshold,
        viable: config.scoring.viableThreshold,
      },
    },
  };
}

/** Reinforces or dampens the design choices behind a rated run. */
export function learnFromScore(input: {
  market: string;
  concept: Concept;
  run: RunRecord;
  /** An explicit dislike is a stronger statement than a low score, and learns differently. */
  verdict?: FeedbackVerdict;
  /** Reason ids, when the listener named one, which sharpens what the update blames. */
  reasons?: string[];
}): string[] {
  const human = input.run.humanScore;
  if (human === null || human === undefined) return [];

  // One learner for both paths: a run rating and a dislike on a song move the same weights, and two
  // implementations of "how much does this move a weight" would drift apart within a week.
  const params = input.concept.params ?? {};
  return learnFromFeedback({
    market: input.market,
    verdict: input.verdict ?? 'like',
    score: human,
    reasons: input.reasons,
    features: {
      genre: input.concept.primaryGenre,
      bpm: input.run.reportedBpm ?? input.concept.bpm,
      keyScale: input.concept.keyScale,
      style: input.concept.style,
      agent: typeof params.lyricAgent === 'string' ? params.lyricAgent : undefined,
      subject: typeof params.lyricSubject === 'string' ? params.lyricSubject : undefined,
      language: typeof params.lyricLanguage === 'string' ? params.lyricLanguage : undefined,
      themes: Array.isArray(params.lyricThemes) ? (params.lyricThemes as string[]) : undefined,
    },
  });
}