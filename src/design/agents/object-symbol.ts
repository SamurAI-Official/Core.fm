/**
 * Agent: The Object Becomes the Symbol (arrangement-only).
 *
 * Engine: object -> repetition -> association -> emotional transformation.
 *
 * One physical thing is introduced as a thing, then returns word-for-word in front of a
 * different context each time, so the object accumulates meaning without a line of
 * explanation. The object itself never changes - that is the compression.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { onceLine, stageLines, uniq } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

/**
 * The object, drawn once per song.
 *
 * Drawn once because it has to be the same object in every section - and because the report
 * names it, so two independent draws would let the manifest name an object the lyric never
 * mentions.
 */
function objectOf(ctx: LyricContext, pack: LanguagePack): string {
  return onceLine(ctx, 'object-symbol:object', () => stageLines(pack, ctx, 'metaphor', 1)[0], ctx.metaphor);
}

export const objectSymbolAgent: WritingAgent = {
  id: 'object-symbol',
  name: 'The Object Becomes the Symbol',
  engine: ['object', 'repetition', 'association', 'transformation'],
  blurb:
    'One physical object, literally that at first, returning unchanged in front of a different context each time until it stands for something much larger - symbolic compression instead of explanation.',
  needs: [],
  repetition: 'device',

  plan: () => ({
    sections: [
      { section: 'Verse 1', roles: ['context (plain)', 'object'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['object', 'object', 'turn'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['context (doubt)', 'object'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['object', 'object', 'turn'], lines: 3, repeatOf: 'chorus' },
      { section: 'Bridge', roles: ['context (loss)', 'object'], lines: 2, variant: 'bridge' },
      { section: 'Outro', roles: ['object (alone)'], lines: 1, variant: 'outro' },
    ],
    summary: 'one object, unchanged, carried past four different contexts until it means more than it is',
  }),

  write: (section, ctx, pack) => {
    const object = objectOf(ctx, pack);

    switch (section.variant) {
      case 'verse-1':
        return takeLines(uniq([...stageLines(pack, ctx, 'perspective', 2), object]), section.lines);

      case 'verse-2':
        return takeLines(uniq([...stageLines(pack, ctx, 'uncertainty', 2), object]), section.lines);

      case 'bridge':
        return takeLines(
          uniq([stageLines(pack, ctx, 'conclusion', 1)[0] ?? object, object]),
          section.lines,
        );

      case 'outro':
        return takeLines([object], section.lines);

      case 'chorus':
      default:
        return takeLines([object, object, pack.reframe(ctx.hook, ctx.qualifier)], section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => {
    const object = objectOf(ctx, pack);
    const appearances = plan.sections.filter((entry) => entry.roles.some((role) => role.startsWith('object'))).length;
    return {
      object,
      appearances,
      summary: `"${object}" appears in ${appearances} sections, word-for-word, in front of a different context each time`,
    };
  },
};
