// Signal aggregator client.
//
// The aggregator is a separate local service (port 3002) proxied by Vite at
// /aggregator, so all calls here use relative URLs exactly like services/api.ts.
// That keeps LAN access working: the browser only ever talks to the Vite origin.
const BASE = '/aggregator';

export interface TrendGenre {
  genre: string;
  share: number;
}

export interface MarketTrend {
  market: string;
  name: string;
  region: string;
  trackCount: number;
  confidence: number;
  topGenres: TrendGenre[];
  bpm: number;
  tempoClass: string;
  tempoSource: string;
  newEntries: number;
  dropped: number;
  overlapRatio: number;
  hasBaseline: boolean;
  durationMedian: number;
  languages: string[];
  chartLeaders: string[];
  themes: string[];
  concepts: number;
  runs: number;
  rated: number;
  bestComposite: number | null;
  champions: number;
}

export interface TrendConcept {
  id: string;
  market: string;
  briefId: string | null;
  createdAt: string;
  status: 'designed' | 'generating' | 'generated' | 'failed';
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

export interface TrendRun {
  id: string;
  conceptId: string | null;
  market: string;
  iteration: number;
  startedAt: string;
  finishedAt: string | null;
  pipelineJobId: string | null;
  status: string;
  /** Progress stage reported while the pipeline is generating. */
  stage: string | null;
  error: string | null;
  audioUrls: string[];
  /** Playable URLs served by the aggregator (through the /aggregator proxy). */
  audioFiles: string[];
  duration: number | null;
  reportedBpm: number | null;
  reportedKey: string | null;
  timeSignature: string | null;
  marketFit: number | null;
  novelty: number | null;
  engineScore: number | null;
  humanScore: number | null;
  composite: number | null;
  verdict: string | null;
  breakdown: {
    components?: Record<string, number>;
    notes?: string[];
    weights?: Record<string, number>;
  };
}

export interface ConceptPatch {
  title?: string;
  style?: string;
  lyrics?: string;
  instrumental?: boolean;
  vocalLanguage?: string;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  duration?: number;
  batchSize?: number;
  thinking?: boolean;
  primaryGenre?: string;
}

export interface MarketWeights {
  key: string;
  value: number;
}

/** A language the lyric writer has a pack for, as reported by the aggregator. */
export interface TrendLanguage {
  code: string;
  label: string;
  nativeLabel: string;
  reviewStatus: 'unreviewed' | 'native-reviewed';
}

/** A writing style (how a song is built), as reported by the agent registry. */
export interface TrendAgent {
  id: string;
  name: string;
  /** The engine chain, e.g. ['question', 'partial answer', 'consequence', 'new question']. */
  engine: string[];
  blurb: string;
  /** Primitives the style needs from a language pack. */
  needs: Array<{ id: string; label: string }>;
  repetition: 'fault' | 'device';
  /** Language codes whose packs can really write this style today. */
  packs: string[];
}

async function request<T>(endpoint: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${BASE}${endpoint}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((error as { error?: string }).error || `Aggregator request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

function queryString(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
}

/** Truncates an id for compact display. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '-';
}

export const trendsApi = {
  /** Aggregator status plus whether it can reach the ACE-Step pipeline. */
  health: (): Promise<{
    ok: boolean;
    markets: string[];
    pipeline: { url: string; healthy: boolean; detail?: string };
  }> => request('/api/health'),

  overview: (): Promise<{ markets: MarketTrend[] }> => request('/api/overview'),

  markets: (): Promise<{ markets: Array<{ market: string; name: string; language: string; region: string }> }> =>
    request('/api/markets'),

  /**
   * Language options for the concept editor.
   *
   * Served by the aggregator from its own pack registry, so the dropdown can never
   * offer a language the lyric writer cannot write without marking it as a fallback -
   * the list and the capability are the same list.
   */
  languages: (): Promise<{ languages: TrendLanguage[]; pending: string[] }> => request('/api/languages'),

  /**
   * Writing styles. Served from the agent registry for the same reason as languages: the
   * dropdown and the writer must not be able to disagree about which styles exist, and
   * `packs` says which languages can really write each one today.
   */
  agents: (): Promise<{ agents: TrendAgent[]; defaultAgent: string }> => request('/api/agents'),

  /**
   * Rewrites one design's lyrics, optionally with a chosen writing style.
   *
   * Design-time selection alone would leave most styles unreachable, so this is how a style
   * is tried against a market and subject without a full design run or a render.
   */
  rerollLyrics: (
    id: string,
    body: { agent?: string; seed?: number } = {},
  ): Promise<{
    concept: TrendConcept;
    style: { id: string; name: string; source: string; realised: boolean };
    subject: { id: string; label: string; source: string };
    validation: { score: number; meterFit: number; issues: string[] };
  }> => request(`/api/concepts/${id}/reroll-lyrics`, { method: 'POST', body }),

  marketDetail: (
    cc: string,
  ): Promise<{
    market: string;
    brief: {
      id: string;
      summary: string;
      genreWeights: Record<string, number>;
      bpm: { median: number; p25: number; p75: number; tempoClass: string };
      tempoSource: string;
      durationMedian: number;
      languages: string[];
      topArtists: Array<{ name: string; count: number }>;
      topTerms: Array<{ term: string; count: number }>;
      momentum: { hasBaseline: boolean; newEntries: unknown[]; droppedCount: number; overlapRatio: number };
    } | null;
    confidence: number;
    concepts: TrendConcept[];
    runs: TrendRun[];
    weights: MarketWeights[];
    ratingQueue: TrendRun[];
  }> => request(`/api/markets/${cc}`),

  concepts: (params: { market?: string; status?: string; limit?: number } = {}): Promise<{ concepts: TrendConcept[] }> =>
    request(`/api/concepts${queryString(params)}`),

  /** Save user edits to a design (augmentation). */
  updateConcept: (id: string, patch: ConceptPatch): Promise<{ concept: TrendConcept }> =>
    request(`/api/concepts/${id}`, { method: 'PATCH', body: patch }),

  /** Start rendering a design; resolves immediately with a run id to poll. */
  runConcept: (id: string, patch?: ConceptPatch): Promise<{ runId: string; market: string; status: string }> =>
    request(`/api/concepts/${id}/run`, { method: 'POST', body: patch ? { patch } : {} }),

  run: (id: string): Promise<{ run: TrendRun }> => request(`/api/runs/${id}`),

  runs: (params: { market?: string; limit?: number } = {}): Promise<{ runs: TrendRun[] }> =>
    request(`/api/runs${queryString(params)}`),

  ratingQueue: (params: { market?: string; limit?: number } = {}): Promise<{ runs: TrendRun[] }> =>
    request(`/api/rating-queue${queryString(params)}`),

  /** Record a human rating: re-scores the run and updates market weights. */
  rate: (
    runId: string,
    score: number,
    notes?: string,
  ): Promise<{
    runId: string;
    market: string;
    rating: number;
    composite: number;
    marketFit: number;
    novelty: number;
    verdict: string;
    learning: string[];
  }> => request('/api/ratings', { method: 'POST', body: { runId, score, notes } }),

  collect: (
    body: { markets?: string[]; enrichTop?: number } = {},
  ): Promise<{
    totalTracks: number;
    enriched: number;
    errors: number;
    outcomes: Array<{ market: string; source: string; count: number; error?: string }>;
  }> => request('/api/collect', { method: 'POST', body }),

  design: (
    body: { markets?: string[]; perMarket?: number; seed?: number; instrumental?: boolean } = {},
  ): Promise<{ designed: number; concepts: TrendConcept[] }> => request('/api/design', { method: 'POST', body }),

  cycle: (
    body: { markets?: string[]; perMarket?: number; generateLimit?: number; reuseSignals?: boolean; seed?: number } = {},
  ): Promise<{
    cycleId: string;
    briefs: Array<{ market: string; summary: string }>;
    concepts: TrendConcept[];
    executions: Array<{ market: string; status: string; composite?: number; verdict?: string; error?: string }>;
    pipeline: { ok: boolean; detail?: string };
    notes: string[];
  }> => request('/api/cycle', { method: 'POST', body }),

  /** Plain-text report for one market. */
  marketReportText: async (cc: string): Promise<string> => {
    const response = await fetch(`${BASE}/api/report/market/${cc}`);
    return response.text();
  },
};