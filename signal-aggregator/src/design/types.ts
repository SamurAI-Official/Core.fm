/**
 * Concept types: one designed song per market, ready to hand to the pipeline.
 */
import type { MarketBrief } from '../briefs/types.js';

export interface Concept {
  id: string;
  market: string;
  briefId: string | null;
  createdAt: string;
  status: 'designed' | 'generating' | 'generated' | 'failed' | 'scored';
  title: string;
  style: string;
  lyrics: string;
  instrumental: boolean;
  vocalLanguage: string;
  bpm: number;
  keyScale: string;
  timeSignature: string;
  duration: number;
  batchSize: number;
  thinking: boolean;
  enhance: boolean;
  primaryGenre: string;
  seed: number;
  rationale: string;
  params: Record<string, unknown>;
}

export interface MarketWeight {
  key: string;
  value: number;
}

export interface DesignRequest {
  market: string;
  brief: MarketBrief;
  count: number;
  /** Learned weights from scored cycles (genre:*, bpm:*, key:* keys). */
  learnedWeights?: MarketWeight[];
  seed?: number;
  instrumental?: boolean;
}

/** Version/id string recorded per concept for traceability of loop iterations. */
export function iterationTag(cycleN: number): string {
  return `cycle-${cycleN}`;
}