/**
 * Collection orchestrator: runs every adapter for every market, enriches the top
 * chart rows with canonical genre + measured BPM, and persists snapshots.
 *
 * Design rules:
 *  - one failing source/market never aborts the run (errors are recorded);
 *  - enrichment is bounded (top N per market) so a cycle stays quick and polite;
 *  - snapshot rows make momentum measurable (this run vs. the previous run).
 */
import { config } from '../config.js';
import { appleAdapter } from './apple.js';
import { deezerGlobalAdapter, lookupBpm } from './deezer.js';
import { enrichFromItunes } from './itunes.js';
import {
  insertSignals,
  insertSnapshot,
  markEnriched,
  payloadHash,
  setSignalBpm,
  setMeta,
} from './store.js';
import type { SignalTrack, SourceAdapter, SourceOutcome } from './types.js';
import { outcome } from './types.js';

export const adapters: SourceAdapter[] = [appleAdapter, deezerGlobalAdapter];

export interface CollectOptions {
  markets?: string[];
  /** Include the worldwide Deezer adapter (market 'global'). */
  includeGlobal?: boolean;
  /** Enrich the top N chart rows per market with iTunes + Deezer metadata. */
  enrichTop?: number;
  onEvent?: (message: string) => void;
}

export interface CollectReport {
  outcomes: SourceOutcome[];
  totalTracks: number;
  enriched: number;
  errors: number;
}

/**
 * Enriches the top-ranked tracks of a market snapshot.
 * iTunes gives canonical genre + duration; Deezer gives measured BPM.
 */
async function enrichTopTracks(
  market: string,
  tracks: SignalTrack[],
  signalIds: string[],
  limit: number,
  log: (message: string) => void,
): Promise<number> {
  let enriched = 0;
  const candidates = tracks.slice(0, limit);

  for (let index = 0; index < candidates.length; index += 1) {
    const track = candidates[index];
    const signalId = signalIds[index];
    if (!signalId) continue;

    const patch: { canonicalGenres?: string[]; durationMs?: number; releaseDate?: string; bpm?: number } = {};

    if (track.externalId) {
      const itunes = await enrichFromItunes(track.externalId, market);
      if (itunes) {
        if (itunes.canonicalGenres.length > 0) {
          patch.canonicalGenres = itunes.canonicalGenres;
          track.canonicalGenres = itunes.canonicalGenres;
          if (itunes.primaryGenre) track.genres = [...(track.genres ?? []), itunes.primaryGenre];
        }
        if (itunes.durationMs) patch.durationMs = itunes.durationMs;
        if (itunes.releaseDate) patch.releaseDate = itunes.releaseDate;
      }
    }

    if (track.bpm && track.bpm > 0) {
      patch.bpm = track.bpm;
    } else {
      const bpm = await lookupBpm(track.title, track.artist);
      if (bpm) {
        patch.bpm = bpm.bpm;
        track.bpm = bpm.bpm;
        setSignalBpm(signalId, bpm.bpm);
      }
    }

    if (Object.keys(patch).length > 0) {
      markEnriched(signalId, patch);
      enriched += 1;
    }
  }

  log(`  enriched ${enriched}/${candidates.length} tracks`);
  return enriched;
}

export async function collectSignals(options: CollectOptions = {}): Promise<CollectReport> {
  const log = options.onEvent ?? (() => undefined);
  const markets = options.markets ?? config.markets;
  const enrichTop = options.enrichTop ?? 20;
  const outcomes: SourceOutcome[] = [];
  let totalTracks = 0;
  let totalEnriched = 0;

  const plan: Array<{ market: string; adapter: SourceAdapter }> = [];
  for (const market of markets) {
    for (const adapter of adapters) {
      if (adapter.supports && !adapter.supports(market)) continue;
      plan.push({ market, adapter });
    }
  }
  if (options.includeGlobal !== false) {
    for (const adapter of adapters) {
      if (adapter.supports && !adapter.supports('global')) continue;
      if (!plan.some((p) => p.adapter.id === adapter.id && p.market === 'global')) {
        plan.push({ market: 'global', adapter });
      }
    }
  }

  for (const { market, adapter } of plan) {
    const startedAt = Date.now();
    try {
      log(`collect ${adapter.id} -> ${market}`);
      const tracks = await adapter.collect(market);
      const snapshotId = insertSnapshot(market, adapter.id, tracks.length, payloadHash(tracks));
      const signalIds = insertSignals(snapshotId, tracks);

      let enriched = 0;
      if (enrichTop > 0 && tracks.length > 0) {
        enriched = await enrichTopTracks(market, tracks, signalIds, enrichTop, log);
      }

      totalTracks += signalIds.length;
      totalEnriched += enriched;
      outcomes.push(outcome(adapter.id, market, signalIds.length, Date.now() - startedAt, undefined, enriched));
    } catch (error) {
      const message = (error as Error).message || 'unknown error';
      insertSnapshot(market, adapter.id, 0, undefined, message);
      outcomes.push(outcome(adapter.id, market, 0, Date.now() - startedAt, message));
      log(`  ! ${adapter.id}/${market} failed: ${message}`);
    }
  }

  setMeta('last_collect_at', new Date().toISOString());
  return {
    outcomes,
    totalTracks,
    enriched: totalEnriched,
    errors: outcomes.filter((o) => o.error).length,
  };
}