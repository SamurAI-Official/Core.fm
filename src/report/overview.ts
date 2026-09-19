/**
 * Cross-nation overview: the headline "what is popular where" view.
 */
import { pool } from '../db/index.js';
import { config } from '../config.js';
import { marketInfo } from '../markets.js';
import { briefConfidence, latestBrief } from '../briefs/build.js';
import { listConcepts } from '../design/store.js';
import { bar, cell, pct } from './format.js';

export interface MarketOverviewRow {
  market: string;
  name: string;
  region: string;
  trackCount: number;
  confidence: number;
  topGenres: Array<{ genre: string; share: number }>;
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

function topGenres(weights: Record<string, number>, limit = 4): Array<{ genre: string; share: number }> {
  return Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([genre, share]) => ({ genre, share }));
}

export function marketOverview(): MarketOverviewRow[] {
  const rows: MarketOverviewRow[] = [];

  for (const market of config.markets) {
    const brief = latestBrief(market);
    const info = marketInfo(market);
    const concepts = listConcepts({ market, limit: 1000 }).length;
    const { rows: runRows } = pool.query<{ n: number; rated: number }>(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN human_score IS NOT NULL THEN 1 ELSE 0 END) AS rated
       FROM runs WHERE market = ?`,
      [market],
    );
    const { rows: bestRows } = pool.query<{ composite: number | null; champions: number }>(
      `SELECT MAX(composite) AS composite, SUM(CASE WHEN verdict = 'champion' THEN 1 ELSE 0 END) AS champions
       FROM runs WHERE market = ?`,
      [market],
    );

    rows.push({
      market,
      name: info.name,
      region: info.region,
      trackCount: brief?.trackCount ?? 0,
      confidence: brief ? briefConfidence(brief) : 0,
      topGenres: brief ? topGenres(brief.genreWeights) : [],
      bpm: brief?.bpm.median ?? 0,
      tempoClass: brief?.bpm.tempoClass ?? 'unknown',
      tempoSource: brief?.tempoSource ?? 'none',
      newEntries: brief?.momentum.newEntries.length ?? 0,
      dropped: brief?.momentum.droppedCount ?? 0,
      overlapRatio: brief?.momentum.overlapRatio ?? 0,
      hasBaseline: brief?.momentum.hasBaseline ?? false,
      durationMedian: brief?.durationMedian ?? 0,
      languages: brief?.languages ?? [info.language],
      chartLeaders: (brief?.topArtists ?? []).slice(0, 3).map((artist) => artist.name),
      themes: (brief?.topTerms ?? []).slice(0, 8).map((term) => term.term),
      concepts,
      runs: Number(runRows[0]?.n ?? 0),
      rated: Number(runRows[0]?.rated ?? 0),
      bestComposite: bestRows[0]?.composite ?? null,
      champions: Number(bestRows[0]?.champions ?? 0),
    });
  }

  return rows.sort(
    (a, b) => (b.bestComposite ?? 0) - (a.bestComposite ?? 0) || b.trackCount - a.trackCount,
  );
}

/** Headline report across all configured nations. */
export function renderOverviewText(): string {
  const rows = marketOverview();
  const lines: string[] = [];
  lines.push('MUSIC TREND OVERVIEW (by nation)');
  lines.push(`generated: ${new Date().toISOString()}`);
  lines.push('');

  if (rows.every((row) => row.trackCount === 0)) {
    lines.push('No signals collected yet - run: npm run collect');
    return lines.join('\n');
  }

  lines.push(
    `${cell('market', 20)} ${cell('tracks', 7)} ${cell('conf', 6)} ${cell('genres (weighted chart share)', 40)} ${cell('bpm', 5)} ${cell('tempo', 16)} ${cell('new', 5)} ${cell('des', 5)} ${cell('runs', 5)} best`,
  );
  lines.push('-'.repeat(150));

  for (const row of rows) {
    const genres = row.topGenres.map((g) => `${g.genre} ${pct(g.share)}`).join(', ');
    lines.push(
      `${cell(`${row.market} ${row.name}`, 20)} ${cell(String(row.trackCount), 7)} ${cell(row.confidence.toFixed(2), 6)} ${cell(genres, 40)} ${cell(String(row.bpm || '-'), 5)} ${cell(`${row.tempoClass}/${row.tempoSource}`, 16)} ${cell(String(row.newEntries), 5)} ${cell(String(row.concepts), 5)} ${cell(String(row.runs), 5)} ${row.bestComposite === null ? '-' : row.bestComposite.toFixed(2)}`,
    );
  }

  lines.push('');
  lines.push('CHART LEADERS');
  for (const row of rows) {
    if (row.chartLeaders.length === 0) continue;
    lines.push(`  ${cell(row.market, 4)} ${row.chartLeaders.join(' / ')}`);
  }

  lines.push('');
  lines.push('MOMENTUM (churn = share of the chart that changed since the previous snapshot)');
  for (const row of rows) {
    if (row.trackCount === 0) continue;
    if (!row.hasBaseline) {
      lines.push(`  ${cell(row.market, 4)} baseline snapshot - momentum available after the next collection`);
      continue;
    }
    const churn = 1 - row.overlapRatio;
    lines.push(
      `  ${cell(row.market, 4)} ${bar(churn)} ${pct(churn)} churn, ${row.newEntries} new, ${row.dropped} dropped`,
    );
  }

  lines.push('');
  lines.push('RECURRING THEMES');
  for (const row of rows) {
    if (row.themes.length === 0) continue;
    lines.push(`  ${cell(row.market, 4)} ${row.themes.slice(0, 6).join(', ')}`);
  }

  return lines.join('\n');
}