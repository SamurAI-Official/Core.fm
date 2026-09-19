/**
 * Arc composition: turns an arc plan into sections.
 *
 * There are deliberately no lyric templates in this file. A single shared template
 * set is exactly what previously applied English word order to every market, so
 * this module owns only *structure* - which sections exist, how many lines each
 * holds, and how the closing chorus reframes rather than repeats - and delegates
 * every actual line to the language pack that owns the grammar.
 */
import type { LyricStage, SectionPlan } from './arc.js';
import type { LanguagePack, LyricContext } from './lyrics/types.js';

/** Retained alias so callers keep the shorter name. */
export type Ctx = LyricContext;

/** Lines requested per section type (keeps sections song-shaped). */
export function sectionLineCount(section: string): number {
  switch (section) {
    case 'Intro':
      return 1;
    case 'Pre-Chorus':
      return 2;
    case 'Chorus':
      return 4;
    case 'Bridge':
      return 3;
    case 'Outro':
      return 2;
    default:
      return 4;
  }
}

/** Distributes a section's line budget across its stages, earliest stage first. */
export function budgetFor(section: string, stages: LyricStage[]): number[] {
  const target = sectionLineCount(section);
  const base = Math.floor(target / Math.max(stages.length, 1));
  let remainder = target - base * stages.length;
  return stages.map(() => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return Math.max(1, base + extra);
  });
}

/**
 * Renders one section through the language pack.
 *
 * The closing chorus is special: it keeps the pack's own contradiction lines but
 * brackets them with the reframed hook, so the song ends on tension instead of a
 * plain repeat of the chorus.
 */
export function renderSection(plan: SectionPlan, ctx: LyricContext, pack: LanguagePack): string[] {
  if (plan.section === 'Intro') return [pack.introLine(ctx)];

  if (plan.reframe) {
    const reframed = pack.reframe(ctx.hook, ctx.qualifier);
    const body = pack.render.contradiction(4, ctx, new Set());
    // Drop the pack's plain hook line; the reframed hook replaces it.
    const middle = body.filter((line) => line !== ctx.hook).slice(0, 2);
    while (middle.length < 2) middle.push(reframed);
    return [reframed, ...middle, reframed];
  }

  const used = new Set<string>();
  const lines: string[] = [];
  const budget = budgetFor(plan.section, plan.stages);
  plan.stages.forEach((stage, index) => {
    for (const line of pack.render[stage](budget[index], ctx, used)) {
      if (used.has(line)) continue;
      used.add(line);
      lines.push(line);
    }
  });
  return lines;
}