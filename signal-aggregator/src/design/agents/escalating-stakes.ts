/**
 * Agent: The Escalating Stakes.
 *
 * Engine: small consequence -> larger consequence -> irreversible consequence.
 *
 * One idea made progressively more expensive. The steps come from the pack's `ladder` bank, and
 * the array order *is* the escalation, so the style reads them in order and the gate checks the
 * order survived - an escalation that is not ordered is just a list of bad luck.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { oncePrimitive, stageLines, uniq } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

/** Step `index` of the ladder, drawn once per song so the report and the lyric agree. */
function step(ctx: LyricContext, pack: LanguagePack, index: number): string {
  return oncePrimitive(ctx, pack, 'ladder', `escalating-stakes:step${index}`, index) ?? ctx.hook;
}

export const escalatingStakesAgent: WritingAgent = {
  id: 'escalating-stakes',
  name: 'The Escalating Stakes',
  engine: ['small consequence', 'larger consequence', 'irreversible consequence'],
  blurb:
    'One idea made more expensive, line by line, until it cannot be undone. The listener keeps asking what happens next, and the song keeps answering with something worse.',
  needs: ['ladder'],
  repetition: 'fault',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['stake (small)'], lines: 2, variant: 'step-1' },
      { section: 'Chorus', roles: ['refrain', 'stake'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['stake (larger)'], lines: 2, variant: 'step-3' },
      { section: 'Chorus', roles: ['refrain', 'stake'], lines: 3, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['stake (irreversible)'], lines: 2, variant: 'step-4' });
    }
    sections.push({ section: 'Outro', roles: ['refrain', 'unstated'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'the stakes climb step by step from a lost key to money that cannot be found, in the order the bank declares',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'step-1':
        return takeLines(uniq([step(ctx, pack, 0), step(ctx, pack, 1)]), section.lines);

      case 'step-3':
        return takeLines(uniq([step(ctx, pack, 3), stageLines(pack, ctx, 'perspective', 1)[0] ?? ctx.hook]), section.lines);

      case 'bridge':
        return takeLines(uniq([step(ctx, pack, 4), ctx.hook]), section.lines);

      case 'outro':
        return takeLines(uniq([ctx.hook, stageLines(pack, ctx, 'conclusion', 1)[0] ?? ctx.hook]), section.lines);

      case 'chorus':
      default:
        // The middle rung sits inside the chorus, so the pattern is not only in the verses.
        return takeLines(uniq([ctx.hook, step(ctx, pack, 2), step(ctx, pack, 3)]), section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => {
    const steps = [0, 1, 2, 3, 4].map((index) => step(ctx, pack, index));
    return {
      steps,
      sections: plan.sections.length,
      summary: `escalates through ${new Set(steps).size} step(s): ${steps.slice(0, 3).join(' -> ')} ...`,
    };
  },
};
