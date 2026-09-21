/**
 * Market brief builder: turns raw signals into one explainable profile per
 * country (genre mix, tempo, momentum, themes) that drives song design.
 */
import { pool, jsonParse } from '../db/index.js';
import { config } from '../config.js';
import { marketInfo } from '../markets.js';
import { round, uuid, unique } from '../lib/util.js';
import { GENRE_TEMPO_HINTS, summarizeTempo } from '../analysis/tempo.js';
import {
  bpmSamples,
  chartThemes,
  durationMedian,
  genreWeights,
  momentum as computeMomentum,
  topEntities,
  topTerms,
} from '../analysis/metrics.js';
import {
  latestSignals,
  latestSnapshotIds,
  previousSnapshotId,
  signalsForSnapshot,
  type SignalRow,
} from '../sources/store.js';
import { buildSummary, type MarketBrief } from './types.js';

const MIN_BPM_SAMPLE = 5;

/** Builds (and persists) a brief for one market from its latest signals. */
export function buildBrief(market: string): MarketBrief {
  const rows: SignalRow[] = latestSignals(market, 500);
  const info = marketInfo(market);
  const snapshots = latestSnapshotIds(market);

  // Momentum needs the same source's previous snapshot.
  let previousRows: SignalRow[] = [];
  const primary = snapshots[0];
  if (primary) {
    const previousId = previousSnapshotId(market, primary.source, primary.id);
    if (previousId) previousRows = signalsForSnapshot(previousId, 500);
  }

  const weights = genreWeights(rows);
  const samples = bpmSamples(rows);
  const measured = summarizeTempo(samples);

  let tempoSource: MarketBrief['tempoSource'] = 'measured';
  let bpm = measured;
  if (measured.sampleSize < MIN_BPM_SAMPLE) {
    // Fall back to genre-typical tempo weighted by this market's genre mix.
    const hinted: number[] = [];
    for (const [genre, weight] of Object.entries(weights)) {
      const hint = GENRE_TEMPO_HINTS[genre] ?? GENRE_TEMPO_HINTS.other;
      const copies = Math.max(1, Math.round(weight * 20));
      for (let i = 0; i < copies; i += 1) hinted.push(hint.typical);
    }
    tempoSource = measured.sampleSize > 0 ? 'blended' : 'hinted';
    bpm = measured.sampleSize > 0 ? summarizeTempo([...samples, ...hinted]) : summarizeTempo(hinted);
  }

  const move = computeMomentum(rows, previousRows);
  const artists = topEntities(rows, 'artist', 10);
  const terms = topTerms(rows, 20);
  // The phrases the market's own titles keep returning to. The lyric writer picks its subject from
  // these, so they are read from the sample rather than from the static regional table.
  const themes = chartThemes(rows, 8);
  const duration = durationMedian(rows);

  const brief: MarketBrief = {
    id: uuid(),
    market,
    marketName: info.name,
    createdAt: new Date().toISOString(),
    trackCount: rows.length,
    genreWeights: weights,
    momentum: move,
    bpm,
    tempoSource,
    genreBpmHints: Object.fromEntries(
      Object.entries(weights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([genre]) => [genre, GENRE_TEMPO_HINTS[genre] ?? GENRE_TEMPO_HINTS.other]),
    ),
    keyWeights: {}, // no public key data: earned later via ratings
    durationMedian: duration,
    languages: unique([info.language, ...(info.secondaryLanguages ?? [])]),
    topArtists: artists,
    topTerms: terms,
    themes,
    summary: '',
    sources: unique(rows.map((row) => row.source)),
  };

  brief.summary = buildSummary(market, info.name, weights, bpm, tempoSource, move, artists, terms, duration);
  persistBrief(brief);
  return brief;
}

function persistBrief(brief: MarketBrief): void {
  pool.query(
    `INSERT INTO market_briefs (id, market, track_count, genre_weights, momentum, bpm_median, bpm_p25,
                                bpm_p75, tempo_class, key_weights, duration_median, languages,
                                top_artists, top_terms, themes, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      brief.id,
      brief.market,
      brief.trackCount,
      JSON.stringify(brief.genreWeights),
      JSON.stringify({ ...brief.momentum, tempoSource: brief.tempoSource, hints: brief.genreBpmHints }),
      brief.bpm.median,
      brief.bpm.p25,
      brief.bpm.p75,
      brief.bpm.tempoClass,
      JSON.stringify(brief.keyWeights),
      brief.durationMedian,
      JSON.stringify(brief.languages),
      JSON.stringify(brief.topArtists),
      JSON.stringify(brief.topTerms),
      JSON.stringify(brief.themes),
      brief.summary,
    ],
  );
}

export function buildBriefs(markets: string[] = config.markets): MarketBrief[] {
  return markets.map((market) => buildBrief(market));
}
/** Rehydrates the most recent persisted brief for a market (no recomputation). */
export function latestBrief(market: string): MarketBrief | null {
  const { rows } = pool.query<Record<string, unknown>>(
    'SELECT * FROM market_briefs WHERE market = ? ORDER BY created_at DESC LIMIT 1',
    [market],
  );
  const row = rows[0];
  if (!row) return null;

  const info = marketInfo(market);
  const blob = jsonParse<Record<string, unknown>>(row.momentum, {});
  return {
    id: String(row.id),
    market,
    marketName: info.name,
    createdAt: String(row.created_at),
    trackCount: Number(row.track_count ?? 0),
    genreWeights: jsonParse<Record<string, number>>(row.genre_weights, {}),
    momentum: {
      hasBaseline: (blob.hasBaseline as boolean) ?? false,
      newEntries: (blob.newEntries as MarketBrief['momentum']['newEntries']) ?? [],
      droppedCount: Number(blob.droppedCount ?? 0),
      overlapRatio: Number(blob.overlapRatio ?? 0),
      rankGainers: (blob.rankGainers as MarketBrief['momentum']['rankGainers']) ?? [],
      risingArtists: (blob.risingArtists as string[]) ?? [],
    },
    bpm: {
      median: Number(row.bpm_median ?? 0),
      p25: Number(row.bpm_p25 ?? 0),
      p75: Number(row.bpm_p75 ?? 0),
      tempoClass: String(row.tempo_class ?? 'unknown') as MarketBrief['bpm']['tempoClass'],
      sampleSize: Number(row.track_count ?? 0),
    },
    tempoSource: (blob.tempoSource as MarketBrief['tempoSource']) ?? 'hinted',
    genreBpmHints: (blob.hints as MarketBrief['genreBpmHints']) ?? {},
    keyWeights: jsonParse<Record<string, number>>(row.key_weights, {}),
    durationMedian: Number(row.duration_median ?? 200),
    languages: jsonParse<string[]>(row.languages, [info.language]),
    topArtists: jsonParse<MarketBrief['topArtists']>(row.top_artists, []),
    topTerms: jsonParse<MarketBrief['topTerms']>(row.top_terms, []),
    // Absent on briefs written before this column existed, which is exactly when the caller should
    // fall back to the static regional themes.
    themes: jsonParse<string[]>(row.themes, []),
    summary: String(row.summary ?? ''),
    sources: [],
  };
}

/** Confidence in the brief, 0..1 - weights market fit when scoring. */
export function briefConfidence(brief: MarketBrief): number {
  const volume = Math.min(brief.trackCount / 40, 1);
  const tempo = brief.tempoSource === 'measured' ? 1 : brief.tempoSource === 'blended' ? 0.6 : 0.25;
  const momentumData = brief.momentum.overlapRatio > 0 || brief.momentum.newEntries.length > 0 ? 1 : 0.4;
  return round(volume * 0.5 + tempo * 0.3 + momentumData * 0.2, 3);
}