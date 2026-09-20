/**
 * Agent: The Circular Song (arrangement-only).
 *
 * Engine: opening image -> journey -> revelation -> return to the opening image.
 *
 * The song closes on the line it opened with, word-for-word. Nothing in the words changes;
 * the listener does, and that is what makes the return land. The opening line is drawn once
 * and reused, rather than drawn twice and hoped to match.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { onceLine, stageLines } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

/** The line the song has to come back to, drawn once per song. */
function openingOf(ctx: LyricContext, pack: LanguagePack): string {
  return onceLine(ctx, 'circular:opening', () => stageLines(pack, ctx, 'perspective', 1)[0], ctx.hook);
}

export const circularAgent: WritingAgent = {
  id: 'circular',
  name: 'The Circular Song',
  engine: ['opening image', 'journey', 'revelation', 'return to the opening image'],
  blurb:
    'The ending is the beginning. The opening line returns unchanged once the song has given it a reason to mean something else, so the same words are heard differently the second time.',
  needs: [],
  repetition: 'device',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['opening image', 'context'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['contradiction'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['image', 'doubt'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['contradiction'], lines: 3, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['agency', 'revelation'], lines: 3, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['opening image (returned)'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'the opening line returns word-for-word at the end, after the song has earned it a second reading',
    };
  },

  write: (section, ctx, pack) => {
    const opening = openingOf(ctx, pack);
    switch (section.variant) {
      case 'verse-1':
        return takeLines([opening, ...stageLines(pack, ctx, 'perspective', 2)], section.lines);

      case 'verse-2':
        return takeLines([...stageLines(pack, ctx, 'metaphor', 2), ...stageLines(pack, ctx, 'uncertainty', 1)], section.lines);

      case 'bridge':
        return takeLines(
          [...stageLines(pack, ctx, 'agency', 2), stageLines(pack, ctx, 'conclusion', 1)[0] ?? opening],
          section.lines,
        );

      case 'outro':
        // The return, then the line that has changed meaning under it.
        return takeLines([opening, stageLines(pack, ctx, 'conclusion', 1)[0] ?? ctx.hook], section.lines);

      case 'chorus':
      default:
        return takeLines(stageLines(pack, ctx, 'contradiction', 3), section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => ({
    opening: openingOf(ctx, pack),
    sections: plan.sections.map((entry) => entry.section),
    summary: `"${openingOf(ctx, pack)}" opens and closes the song unchanged; everything between is what makes it read differently`,
  }),
};
