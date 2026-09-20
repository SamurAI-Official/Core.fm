/**
 * Agent: Slogan -> Story (arrangement-only).
 *
 * Engine: simple thesis -> examples -> contradiction -> expanded thesis.
 *
 * The thesis is the hook, stated as a slogan and then left alone while the verses accumulate
 * evidence for it. The chorus keeps the same words every time, so what changes is not the
 * phrase but what the listener has seen it survive - and the bridge turns it against itself
 * before the outro hands it back unchanged.
 */
import { takeLines } from '../lyrics/types.js';
import { stageLines } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

export const sloganStoryAgent: WritingAgent = {
  id: 'slogan-story',
  name: 'Slogan → Story',
  engine: ['simple thesis', 'examples', 'contradiction', 'expanded thesis'],
  blurb:
    'A phrase simple enough to be a slogan, then verses that earn it: a concrete example, then the counter-example, then the same phrase again with evidence behind it.',
  needs: [],
  // The thesis returns word-for-word, which is the whole point of the style.
  repetition: 'device',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Intro', roles: ['thesis (bare)'], lines: 1, variant: 'intro' },
      { section: 'Verse 1', roles: ['example'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['thesis', 'counter-example'], lines: 4, variant: 'chorus' },
      { section: 'Verse 2', roles: ['example (image)'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['thesis', 'counter-example'], lines: 4, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['contradiction', 'thesis (turned)'], lines: 3, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['thesis (earned)'], lines: 1, variant: 'outro' });
    return {
      sections,
      summary:
        'the hook stands as a slogan while the verses accumulate evidence for it, the bridge turns it against itself, and the outro hands the same words back unchanged',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'intro':
      case 'outro':
        // The same sentence, before and after everything the song has shown.
        return takeLines([ctx.hook], section.lines);

      case 'verse-1':
        // Evidence from where and when the singer stands.
        return takeLines(stageLines(pack, ctx, 'perspective', 3), section.lines);

      case 'verse-2':
        // Evidence from a physical object, which is harder to argue with.
        return takeLines(stageLines(pack, ctx, 'metaphor', 3), section.lines);

      case 'bridge':
        return takeLines(
          [stageLines(pack, ctx, 'contradiction', 3)[1] ?? ctx.hook, pack.reframe(ctx.hook, ctx.qualifier)],
          section.lines,
        );

      case 'chorus':
      default:
        return takeLines(
          [ctx.hook, ctx.hook, stageLines(pack, ctx, 'contradiction', 4)[1] ?? ctx.hook],
          section.lines,
        );
    }
  },

  report: (ctx, plan): AgentReport => ({
    thesis: ctx.hook,
    statements: plan.sections.filter((entry) => entry.roles.some((role) => role.startsWith('thesis'))).length,
    summary: `"${ctx.hook}" stated ${plan.sections.filter((entry) => entry.roles.some((role) => role.startsWith('thesis'))).length}x with the verses left to earn it`,
  }),
};
