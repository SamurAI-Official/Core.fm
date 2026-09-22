/**
 * The full loop: collect -> brief -> design -> generate -> score -> (rate) -> repeat.
 *
 * Each cycle is persisted so the next one starts from what was learned, and the
 * adaptive weights only move when a human rating exists (see scoring/score.ts).
 */
import { config } from '../config.js';
import { pool } from '../db/index.js';
import { uuid } from '../lib/util.js';
import { collectSignals, type CollectReport } from '../sources/collect.js';
import { buildBrief, latestBrief } from '../briefs/build.js';
import type { MarketBrief } from '../briefs/types.js';
import { designConcepts } from '../design/designer.js';
import type { Concept } from '../design/types.js';
import { executeConcepts, type ExecuteOptions, type ExecuteResult } from '../pipeline/run.js';
import { getWeightsForMarkets } from '../loops/ratings.js';
import { decayWeights } from '../loops/decay.js';
import { pipeline } from '../pipeline/client.js';

export interface CycleOptions {
  markets?: string[];
  /** Skip collection and reuse the latest signals (fast iteration). */
  reuseSignals?: boolean;
  /** Concepts to design per market. */
  perMarket?: number;
  /** How many designed concepts to actually render (GPU time). */
  generateLimit?: number;
  /** Tracks per market to enrich with genre/BPM metadata. */
  enrichTop?: number;
  /** Force instrumental designs. */
  instrumental?: boolean;
  seed?: number;
  onEvent?: (message: string) => void;
  /** Refuse to generate when the pipeline is down (default true). */
  requirePipeline?: boolean;
}

export interface CycleReport {
  cycleId: string;
  startedAt: string;
  finishedAt: string;
  markets: string[];
  collect?: CollectReport;
  briefs: MarketBrief[];
  concepts: Concept[];
  executions: ExecuteResult[];
  pipeline: { ok: boolean; detail?: string };
  notes: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Picks which concepts to render: spreads the GPU budget across markets and
 * prefers designs closest to their market's genre mix and tempo.
 */
function selectForGeneration(concepts: Concept[], limit: number, markets: string[]): Concept[] {
  const perMarketBudget = Math.max(1, Math.floor(limit / Math.max(markets.length, 1)));
  const selected: Concept[] = [];
  for (const market of markets) {
    const forMarket = concepts
      .filter((concept) => concept.market === market)
      .sort((a, b) => confidenceScore(b) - confidenceScore(a))
      .slice(0, perMarketBudget);
    selected.push(...forMarket);
  }
  return selected.slice(0, limit);
}

/** Ranks a concept by how closely it tracks its market's tempo and genre mix. */
function confidenceScore(concept: Concept): number {
  const brief = latestBrief(concept.market);
  if (!brief) return 0;
  const bpmDistance = brief.bpm.median > 0 ? Math.abs(concept.bpm - brief.bpm.median) / 30 : 0.5;
  const genreShare = brief.genreWeights[concept.primaryGenre] ?? 0;
  return genreShare * 2 - bpmDistance;
}

export async function runCycle(options: CycleOptions = {}): Promise<CycleReport> {
  const log = options.onEvent ?? (() => undefined);
  const markets = options.markets ?? config.markets;
  const perMarket = options.perMarket ?? config.design.conceptsPerMarket;
  const generateLimit = options.generateLimit ?? 0;
  const cycleId = uuid();
  const startedAt = nowIso();
  const notes: string[] = [];

  // Before anything is decided, let go of what nobody has confirmed for a while. A cycle that ran after
  // a long pause used to design from the weights as they were when the service stopped; now an opinion
  // that has not been repeated fades first, which is the whole point of decay being time-based.
  const decay = decayWeights();
  const decayed = decay.scopes.reduce((total, scope) => total + scope.moved, 0);
  if (decayed > 0) {
    const dropped = decay.scopes.reduce((total, scope) => total + scope.purged, 0);
    notes.push(
      `decayed ${decayed} stale weight${decayed === 1 ? '' : 's'}` +
        (dropped > 0 ? ` (${dropped} back to neutral)` : '') +
        ` at ${(decay.ratePerWeek * 100).toFixed(2)}%/week`,
    );
    log(notes[notes.length - 1]);
  }

  pool.query('INSERT INTO cycles (id, markets) VALUES (?, ?)', [cycleId, JSON.stringify(markets)]);

  // --- 1. pipeline availability -------------------------------------------------
  const health = await pipeline.health();
  log(
    `pipeline ${health.ok ? 'healthy' : 'unavailable'} (${health.url || pipeline.baseUrl})${health.detail ? ` - ${health.detail}` : ''}`,
  );
  if (!health.ok && generateLimit > 0 && options.requirePipeline !== false) {
    notes.push(`generation skipped: pipeline unreachable (${health.detail ?? 'unknown error'})`);
    log('pipeline unreachable - generation skipped so no GPU cycles are wasted');
  }

  // --- 2. collect ---------------------------------------------------------------
  let collect: CollectReport | undefined;
  if (!options.reuseSignals) {
    log(`collecting signals for ${markets.join(', ')}`);
    collect = await collectSignals({ markets, enrichTop: options.enrichTop ?? 20, onEvent: log });
    log(`collected ${collect.totalTracks} signals (${collect.errors} source errors, ${collect.enriched} enriched)`);
  } else {
    notes.push('collection skipped: reused latest snapshots');
  }

  // --- 3. briefs ----------------------------------------------------------------
  log('building market briefs');
  const briefs = markets.map((market) => buildBrief(market));
  for (const brief of briefs) log(`  ${brief.market}: ${brief.summary}`);

  // --- 4. design ----------------------------------------------------------------
  const weights = getWeightsForMarkets(markets);
  log(`designing ${perMarket} concept(s) per market`);
  const concepts = briefs.flatMap((brief) =>
    designConcepts({
      market: brief.market,
      brief,
      count: perMarket,
      learnedWeights: weights[brief.market],
      seed: options.seed,
      instrumental: options.instrumental,
    }),
  );
  for (const concept of concepts) {
    log(
      `  ${concept.market} | ${concept.title} | ${concept.primaryGenre} | ${concept.bpm} bpm | ${concept.keyScale} | ${concept.vocalLanguage}`,
    );
  }

  // --- 5. generate --------------------------------------------------------------
  let executions: ExecuteResult[] = [];
  if (generateLimit > 0 && health.ok) {
    const selection = selectForGeneration(concepts, generateLimit, markets);
    log(`rendering ${selection.length} concept(s) via the pipeline`);
    executions = await executeConcepts(selection, { onEvent: log } as ExecuteOptions);
  } else if (generateLimit > 0) {
    log('generation skipped: pipeline not reachable');
  }

  // --- 6. persist ---------------------------------------------------------------
  const succeeded = executions.filter((e) => e.status === 'succeeded').length;
  const failed = executions.length - succeeded;
  const finishedAt = nowIso();
  pool.query(
    `UPDATE cycles SET finished_at = ?, concepts_created = ?, generated = ?, succeeded = ?, failed = ?, notes = ?
     WHERE id = ?`,
    [finishedAt, concepts.length, executions.length, succeeded, failed, notes.join(' | '), cycleId],
  );
  log(`cycle ${cycleId} complete: ${concepts.length} concepts, ${succeeded} rendered, ${failed} failed`);

  return {
    cycleId,
    startedAt,
    finishedAt,
    markets,
    collect,
    briefs,
    concepts,
    executions,
    pipeline: { ok: health.ok, detail: health.detail },
    notes,
  };
}