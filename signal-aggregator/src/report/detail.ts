/**
 * Per-market and per-cycle detail reports.
 */
import { marketInfo } from '../markets.js';
import { briefConfidence, latestBrief } from '../briefs/build.js';
import { listConcepts } from '../design/store.js';
import { listRuns } from '../loops/store.js';
import { getWeights, listRatings } from '../loops/ratings.js';
import type { CycleReport } from '../loops/cycle.js';
import { bar, describeRun, pct, ts } from './format.js';

/** Detailed single-market report: brief, learned preferences, designs, runs. */
export function renderMarketText(market: string): string {
  const brief = latestBrief(market);
  const info = marketInfo(market);
  const lines: string[] = [];
  lines.push(`${info.name} (${market})`);
  lines.push('-'.repeat(70));

  if (!brief) {
    lines.push('No brief yet. Run: npm run collect && npm run brief');
    return lines.join('\n');
  }

  lines.push(`brief      : ${brief.id}`);
  lines.push(`summary    : ${brief.summary}`);
  lines.push(`confidence : ${briefConfidence(brief)}`);
  lines.push(`languages  : ${brief.languages.join(', ')}`);
  lines.push(`sources    : ${brief.sources.join(', ') || 'n/a'}`);
  lines.push('');

  lines.push('GENRE MIX (weighted chart share)');
  for (const [genre, share] of Object.entries(brief.genreWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)) {
    lines.push(`  ${genre.padEnd(24)} ${bar(share * 3)} ${pct(share, 1)}`);
  }

  lines.push('');
  lines.push(`TEMPO       : ${brief.bpm.median} BPM (p25 ${brief.bpm.p25}, p75 ${brief.bpm.p75}) [${brief.tempoSource}]`);
  lines.push(`LENGTH      : ~${brief.durationMedian}s`);
  if (brief.topArtists.length > 0) {
    lines.push(`LEADERS     : ${brief.topArtists.slice(0, 6).map((a) => `${a.name} (${a.count})`).join(', ')}`);
  }
  if (brief.topTerms.length > 0) {
    lines.push(`THEMES      : ${brief.topTerms.slice(0, 12).map((t) => t.term).join(', ')}`);
  }

  lines.push('');
  if (!brief.momentum.hasBaseline) {
    lines.push('MOMENTUM    : baseline snapshot (nothing to compare against yet)');
  } else {
    lines.push(
      `MOMENTUM    : ${brief.momentum.newEntries.length} new, ${brief.momentum.droppedCount} dropped, overlap ${pct(brief.momentum.overlapRatio)}`,
    );
  }
  for (const gainer of brief.momentum.rankGainers.slice(0, 5)) {
    lines.push(`  rising    : ${gainer.title} - ${gainer.artist ?? '?'} (${gainer.from} -> ${gainer.to})`);
  }
  for (const entry of brief.momentum.newEntries.slice(0, 5)) {
    lines.push(`  new entry : #${entry.rank ?? '?'} ${entry.title} - ${entry.artist ?? '?'}`);
  }

  const learns = getWeights(market).filter((weight) => Math.abs(weight.value - 1) > 0.05);
  if (learns.length > 0) {
    lines.push('');
    lines.push('LEARNED PREFERENCES (from human ratings)');
    for (const weight of learns.slice(0, 12)) {
      lines.push(`  ${weight.key.padEnd(32)} x${weight.value.toFixed(3)}`);
    }
  }

  const concepts = listConcepts({ market, limit: 6 });
  if (concepts.length > 0) {
    lines.push('');
    lines.push('RECENT DESIGNS');
    for (const concept of concepts) {
      lines.push(`  ${ts(concept.createdAt)} | ${concept.title} | ${concept.primaryGenre} | ${concept.bpm} bpm | ${concept.status}`);
      lines.push(`    style : ${concept.style}`);
      lines.push(`    why   : ${concept.rationale}`);
    }
  }

  const runs = listRuns({ market, limit: 6 });
  if (runs.length > 0) {
    lines.push('');
    lines.push('RUNS');
    for (const run of runs) lines.push(describeRun(run));
  }

  const ratings = listRatings(market, 5);
  if (ratings.length > 0) {
    lines.push('');
    lines.push('LATEST RATINGS');
    for (const rating of ratings) {
      lines.push(
        `  ${ts(rating.createdAt)} ${rating.runId.slice(0, 8)} -> ${rating.score}${rating.notes ? ` (${rating.notes})` : ''}`,
      );
    }
  }

  return lines.join('\n');
}

/** Summary of one cycle execution. */
export function renderCycleText(report: CycleReport): string {
  const lines: string[] = [];
  const succeeded = report.executions.filter((execution) => execution.status === 'succeeded');
  lines.push('CYCLE SUMMARY');
  lines.push(`cycle    : ${report.cycleId}`);
  lines.push(`window   : ${ts(report.startedAt)} -> ${ts(report.finishedAt)}`);
  lines.push(`markets  : ${report.markets.join(', ')}`);
  lines.push(`pipeline : ${report.pipeline.ok ? 'healthy' : `unavailable (${report.pipeline.detail ?? 'unknown'})`}`);
  if (report.collect) {
    lines.push(
      `collected: ${report.collect.totalTracks} signals, ${report.collect.enriched} enriched, ${report.collect.errors} source errors`,
    );
  }
  lines.push(`designed : ${report.concepts.length} concept(s)`);
  lines.push(`rendered : ${succeeded.length}/${report.executions.length}`);

  lines.push('');
  lines.push('DESIGNED');
  for (const concept of report.concepts) {
    lines.push(`  ${concept.market} | ${concept.title} | ${concept.primaryGenre} | ${concept.bpm} bpm | ${concept.keyScale}`);
  }

  if (report.executions.length > 0) {
    lines.push('');
    lines.push('RENDERS');
    for (const execution of report.executions) {
      const score = execution.composite === undefined ? '' : ` composite ${execution.composite} ${execution.verdict ?? ''}`;
      lines.push(`  ${execution.market} | ${execution.status}${score}${execution.error ? ` | ${execution.error}` : ''}`);
      for (const file of execution.audioPaths) lines.push(`    audio: ${file}`);
      for (const learn of execution.learning) lines.push(`    learned: ${learn}`);
    }
  }

  if (report.notes.length > 0) {
    lines.push('');
    lines.push(`notes: ${report.notes.join(' | ')}`);
  }

  return lines.join('\n');
}