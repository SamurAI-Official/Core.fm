/**
 * Repetition audit for stored designs.
 *
 * `agent-spread.ts` holds the *writer* to the repetition ceilings. This measures what is
 * actually stored: per market, per style, and the worst offenders. It exists because a lyric can
 * be repetitive in a way the writer's own gate cannot see - the 2026-09-21 batch averaged 39%
 * duplicated lines with one line sung 9x in 16 lines - so "did the fix reach the stored designs?"
 * needs an answer that reads the database rather than the renderer.
 *
 * Measurement comes from the validator (`validateLyrics`), never a second implementation:
 * section headers are excluded, and a line and its parenthesised backing-vocal echo count as one
 * line, exactly as the writer and the gate judge them.
 *
 *   npx tsx scripts/lyric-repetition-audit.ts
 *   npx tsx scripts/lyric-repetition-audit.ts --market us --limit 100
 *   npx tsx scripts/lyric-repetition-audit.ts --since 2026-09-21T22:00
 */
import { listConcepts } from '../src/design/store.js';
import type { Concept } from '../src/design/types.js';
import { resolvePack } from '../src/design/lyrics/index.js';
import { validateLyrics } from '../src/design/lyrics/validate.js';

const argValue = (key: string): string | undefined => {
  const index = process.argv.indexOf(`--${key}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const market = argValue('market')?.toLowerCase();
const limit = Number(argValue('limit') ?? 1000);
const since = argValue('since');

/** Ceilings the gate enforces on the writer, restated here so the report can flag breaches. */
const MAX_DEVICE_LINE_SHARE = 0.4;
const MAX_FAULT_LINE_SHARE = 0.35;

interface Measured {
  concept: Concept;
  agent: string;
  policy: 'device' | 'fault';
  lines: number;
  distinct: number;
  duplicateShare: number;
  lineShare: number;
  mostSung: string;
  mostSungCount: number;
}

function measure(concept: Concept): Measured | null {
  if (concept.instrumental) return null;
  const lyrics = (concept.lyrics ?? '').trim();
  if (!lyrics) return null;

  const params = concept.params ?? {};
  const policy: 'device' | 'fault' = params.lyricRepetitionPolicy === 'device' ? 'device' : 'fault';
  const language =
    typeof params.lyricLanguage === 'string' && params.lyricLanguage.length > 0
      ? params.lyricLanguage
      : concept.vocalLanguage;

  const validation = validateLyrics(lyrics, {
    language,
    script: resolvePack(language).pack.script,
    bpm: concept.bpm,
    timeSignature: concept.timeSignature,
    repetitionPolicy: policy,
  });
  if (validation.lineCount === 0) return null;

  return {
    concept,
    agent: typeof params.lyricAgent === 'string' ? params.lyricAgent : '(unrecorded)',
    policy,
    lines: validation.lineCount,
    distinct: Math.round(validation.distinctLineShare * validation.lineCount),
    duplicateShare: 1 - validation.distinctLineShare,
    lineShare: validation.maxLineShare,
    mostSung: validation.mostSungLine,
    mostSungCount: validation.maxLineRepeats,
  };
}

const concepts = listConcepts({ market, limit }).filter(
  (concept) => !since || concept.createdAt >= since,
);
const scored = concepts.map(measure).filter((row): row is Measured => row !== null);

if (scored.length === 0) {
  console.log('no stored designs with lyrics matched');
  process.exit(0);
}

const average = (pick: (row: Measured) => number): number =>
  scored.reduce((total, row) => total + pick(row), 0) / scored.length;
const breaches = scored.filter(
  (row) => row.lineShare > (row.policy === 'device' ? MAX_DEVICE_LINE_SHARE : MAX_FAULT_LINE_SHARE),
);

console.log(`${scored.length} stored design(s) with lyrics${market ? ` in ${market}` : ''}${since ? ` since ${since}` : ''}`);
console.log(`  average duplicated lines  : ${(average((r) => r.duplicateShare) * 100).toFixed(1)}%`);
console.log(`  average single-line share : ${(average((r) => r.lineShare) * 100).toFixed(1)}%`);
console.log(`  average lyric length      : ${average((r) => r.lines).toFixed(1)} lines, ${average((r) => r.distinct).toFixed(1)} distinct`);
console.log(`  over the line-share ceiling: ${breaches.length} of ${scored.length}`);

const byStyle = new Map<string, { n: number; duplicate: number; worst: number; worstLine: string }>();
for (const row of scored) {
  const key = `${row.agent} [${row.policy}]`;
  const entry = byStyle.get(key) ?? { n: 0, duplicate: 0, worst: 0, worstLine: '' };
  entry.n += 1;
  entry.duplicate += row.duplicateShare;
  if (row.lineShare > entry.worst) {
    entry.worst = row.lineShare;
    entry.worstLine = row.mostSung;
  }
  byStyle.set(key, entry);
}

console.log('\nby writing style:');
console.log('  style [policy]                     n   avgDup  worstLine');
for (const [key, entry] of [...byStyle.entries()].sort((a, b) => b[1].duplicate / b[1].n - a[1].duplicate / a[1].n)) {
  console.log(
    `  ${key.padEnd(32)} ${String(entry.n).padStart(3)}   ${(100 * entry.duplicate / entry.n).toFixed(0).padStart(5)}%   ` +
      `${(entry.worst * 100).toFixed(0).padStart(6)}%`,
  );
}

console.log('\nworst designs by single-line share:');
for (const row of [...scored].sort((a, b) => b.lineShare - a.lineShare).slice(0, 10)) {
  console.log(
    `  ${(row.lineShare * 100).toFixed(0).padStart(3)}%  ${row.concept.market}  ${row.agent.padEnd(20)} [${row.policy}] ` +
      `${row.mostSungCount}x of ${row.lines}: "${row.mostSung}"`,
  );
}

process.exit(breaches.length === 0 ? 0 : 1);
