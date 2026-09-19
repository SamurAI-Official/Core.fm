/**
 * Ad-hoc inspection helper: prints the language provenance recorded per concept.
 *   npx tsx scripts/inspect-concepts.ts [limit]
 */
import { pool } from '../src/db/index.js';

const limit = Number(process.argv[2] ?? 3);
const { rows } = pool.query<{
  market: string;
  title: string;
  vocal_language: string | null;
  params: string | null;
}>(`SELECT market, title, vocal_language, params FROM concepts ORDER BY created_at DESC LIMIT ?`, [limit]);

for (const row of rows) {
  const params = JSON.parse(row.params ?? '{}') as Record<string, unknown>;
  const validation = (params.lyricValidation ?? {}) as Record<string, unknown>;
  const issues = (validation.issues ?? []) as string[];
  const parts = [
    row.market.toUpperCase().padEnd(3),
    `vocal_language=${row.vocal_language}`,
    `requested=${params.requestedLanguage}`,
    `written=${params.lyricLanguage}`,
    `fallback=${params.lyricLanguageFallback}`,
    `singability=${validation.score ?? '-'}`,
    `issues=${issues.length}`,
  ];
  console.log(parts.join(' | '));
  console.log(`    title: ${row.title}`);
  if (issues.length > 0) console.log(`    first issue: ${issues[0]}`);
}
