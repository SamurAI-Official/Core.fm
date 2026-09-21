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
import { onceLine, stageLines, uniq, withoutLine } from './shared.js';
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
      { section: 'Chorus', roles: ['object', 'turn', 'context'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['context (doubt)', 'object'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['object', 'turn', 'context'], lines: 3, repeatOf: 'chorus' },
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
        // The context only, as in verse 1's counterpart: the object returns with the chorus right
        // behind it. Holding it back also keeps the object out of six of fifteen lines, which is
        // what "carried past four different contexts" means rather than "in every line".
        return takeLines(uniq(withoutLine(stageLines(pack, ctx, 'uncertainty', 2), object)), section.lines);

      case 'bridge': {
        // A fresh context, minus the two lines the song already owns: the object itself and the
        // chorus's turn. The conclusion bank can hand back the same phrase the turn uses, and the
        // validator counts a line and its parenthesised echo as one - so it has to go.
        const turn = pack.reframe(ctx.hook, ctx.qualifier);
        const context = stageLines(pack, ctx, 'conclusion', 3)
          .filter((line) => line !== object && line !== turn)
          .slice(0, 1);
        return takeLines([...context, object], section.lines);
      }

      case 'outro':
        return takeLines([object], section.lines);

      case 'chorus':
      default:
        // The object once, then the turn and a fresh context. It used to appear twice per chorus
        // *and* in every other section, which measured as the object being 53% of the lyric.
        return takeLines(
          uniq([object, pack.reframe(ctx.hook, ctx.qualifier), ...stageLines(pack, ctx, 'contradiction', 2)]),
          section.lines,
        );
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
