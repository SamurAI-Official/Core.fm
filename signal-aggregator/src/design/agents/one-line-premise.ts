/**
 * Agent: The One-Line Premise (arrangement-only).
 *
 * Engine: compressed premise -> unanswered implication -> the song expands the premise.
 *
 * One sentence that contains a contradiction and therefore a whole story, stated before
 * anything is explained and stated again, unchanged, once it has been. The premise is the
 * hook plus its qualifier ("...or maybe we don't"), which is a contradiction by construction:
 * one claim and its own retraction in a single line.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { onceLine, stageLines } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

export const oneLinePremiseAgent: WritingAgent = {
  id: 'one-line-premise',
  name: 'The One-Line Premise',
  engine: ['compressed premise', 'unanswered implication', 'expansion'],
  blurb:
    'A single self-contradicting sentence that implies an entire story, stated before anything is explained and returned unchanged once the song has filled it in.',
  needs: [],
  repetition: 'device',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Intro', roles: ['premise'], lines: 1, variant: 'premise' },
      { section: 'Verse 1', roles: ['implication'], lines: 4, variant: 'verse-1' },
      // The premise and the claim it contradicts, and that is all: the chorus used to bracket
      // itself with the premise as well, which is where its fourth and fifth statements came from.
      { section: 'Chorus', roles: ['premise', 'pressure'], lines: 2, variant: 'chorus' },
      { section: 'Verse 2', roles: ['implication (image)'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['premise', 'pressure'], lines: 2, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['premise (bare)'], lines: 2, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['premise'], lines: 1, variant: 'outro' });
    return {
      sections,
      summary:
        'one contradicted sentence in a single line, left unexplained while the song fills it in, and returned unchanged at the end',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'premise':
      case 'outro':
        return takeLines([premiseOf(ctx, pack)], section.lines);

      case 'verse-1':
        // Where the singer stands, then what they do not know about it.
        return takeLines(
          [...stageLines(pack, ctx, 'perspective', 2), ...stageLines(pack, ctx, 'uncertainty', 2)],
          section.lines,
        );

      case 'verse-2':
        return takeLines([...stageLines(pack, ctx, 'metaphor', 2), ...stageLines(pack, ctx, 'agency', 1)], section.lines);

      case 'bridge':
        return takeLines(
          [premiseOf(ctx, pack), stageLines(pack, ctx, 'conclusion', 1)[0] ?? ctx.hook],
          section.lines,
        );

      case 'chorus':
      default:
        // The premise, then the claim on its own: the retraction is what keeps the line from
        // settling, and one statement per chorus is enough to carry it.
        return takeLines([premiseOf(ctx, pack), ctx.hook], section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => {
    const premise = premiseOf(ctx, pack);
    return {
      premise,
      statements: plan.sections.filter((entry) => entry.roles.some((role) => role.startsWith('premise'))).length,
      summary: `premise "${premise}" - a claim and its own retraction in one line, stated ${plan.sections.filter((entry) => entry.roles.some((role) => role.startsWith('premise'))).length}x and never resolved`,
    };
  },
};

/**
 * The premise, drawn once per song.
 *
 * `pack.reframe` owns the grammar of the retraction, so it is called (once) rather than
 * reimplemented here - a second implementation would be a second definition of the premise.
 */
function premiseOf(ctx: LyricContext, pack: LanguagePack): string {
  return onceLine(ctx, 'one-line-premise:premise', () => pack.reframe(ctx.hook, ctx.qualifier), ctx.hook);
}
