/**
 * Rating entry point: recording a human/panel score for a run re-computes that
 * run's composite score and applies the learning update, so a rating immediately
 * changes what the next design cycle will prefer.
 */
import { getConcept } from '../design/store.js';
import { latestBrief } from '../briefs/build.js';
import { humanScore, insertRating } from './ratings.js';
import { getRun, saveScores, setRunHumanScore, type RunRecord } from './store.js';
import { learnFromScore, scoreRun, type Verdict } from '../scoring/score.js';

export interface RateInput {
  runId: string;
  /** 0..1 (0 = poor fit for the market, 1 = strong hit). */
  score: number;
  notes?: string;
  rater?: string;
}

export interface RateResult {
  runId: string;
  market: string;
  rating: number;
  composite: number;
  marketFit: number;
  novelty: number;
  verdict: Verdict;
  learning: string[];
}

export function rateRun(input: RateInput): RateResult {
  const run = getRun(input.runId);
  if (!run) throw new Error(`run not found: ${input.runId}`);

  const score = Math.min(1, Math.max(0, input.score));
  insertRating({
    runId: input.runId,
    market: run.market,
    score,
    notes: input.notes,
    rater: input.rater,
  });

  if (!run.conceptId) throw new Error(`run ${input.runId} has no concept to re-score`);
  const concept = getConcept(run.conceptId);
  if (!concept) throw new Error(`concept not found for run ${input.runId}`);
  const brief = latestBrief(run.market);
  if (!brief) throw new Error(`no brief available for market ${run.market}`);

  const rated: RunRecord = { ...run, humanScore: humanScore(input.runId) };
  setRunHumanScore(input.runId, rated.humanScore);
  const scored = scoreRun({ run: rated, concept, brief });
  saveScores(input.runId, {
    marketFit: scored.marketFit,
    novelty: scored.novelty,
    engineScore: rated.engineScore,
    composite: scored.composite,
    verdict: scored.verdict,
    breakdown: scored.breakdown as unknown as Record<string, unknown>,
  });

  const learning = learnFromScore({ market: run.market, concept, run: rated });

  return {
    runId: input.runId,
    market: run.market,
    rating: score,
    composite: scored.composite,
    marketFit: scored.marketFit,
    novelty: scored.novelty,
    verdict: scored.verdict,
    learning,
  };
}