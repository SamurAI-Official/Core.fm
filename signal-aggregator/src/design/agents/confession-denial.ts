/**
 * Agent: The Confession -> Denial -> Confession.
 *
 * Engine: reveal -> retreat -> deeper reveal.
 *
 * The song admits something, takes it back immediately, and then admits something truer. The
 * retreat is what makes the third line land: the first confession is the easy one, and the denial
 * is the character refusing it.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { oncePrimitive, stageLines, uniq } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

function confession(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'claim', 'confession-denial:confession') ?? ctx.hook;
}

function denial(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'reversal', 'confession-denial:denial') ?? ctx.hook;
}

function deeper(ctx: LyricContext, pack: LanguagePack): string {
  // The third move is a claim the song has not used yet, so it cannot repeat the first.
  return oncePrimitive(ctx, pack, 'claim', 'confession-denial:deeper', 1) ?? stageLines(pack, ctx, 'conclusion', 1)[0] ?? ctx.hook;
}

export const confessionDenialAgent: WritingAgent = {
  id: 'confession-denial',
  name: 'The Confession → Denial → Confession',
  engine: ['reveal', 'retreat', 'deeper reveal'],
  blurb:
    'Says it, takes it back, then says the truer thing. The denial is the tension that makes the second confession worth hearing.',
  needs: ['claim', 'reversal'],
  repetition: 'fault',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['confession'], lines: 2, variant: 'verse-1' },
      { section: 'Chorus', roles: ['denial', 'refrain'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['confession (harder)'], lines: 2, variant: 'verse-2' },
      { section: 'Chorus', roles: ['denial', 'refrain'], lines: 3, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['deeper confession'], lines: 3, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['deeper confession (alone)'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'a confession, the denial that follows it, and the deeper truth the denial was covering',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'verse-1':
        return takeLines(uniq([confession(ctx, pack), stageLines(pack, ctx, 'perspective', 1)[0] ?? ctx.hook]), section.lines);

      case 'verse-2':
        return takeLines(uniq([confession(ctx, pack), stageLines(pack, ctx, 'uncertainty', 1)[0] ?? ctx.hook]), section.lines);

      case 'bridge':
        return takeLines(
          uniq([deeper(ctx, pack), stageLines(pack, ctx, 'metaphor', 1)[0] ?? ctx.hook, ctx.hook]),
          section.lines,
        );

      case 'outro':
        return takeLines(uniq([deeper(ctx, pack), stageLines(pack, ctx, 'conclusion', 1)[0] ?? ctx.hook]), section.lines);

      case 'chorus':
      default:
        // The retreat, then the words that carry on regardless.
        return takeLines(uniq([denial(ctx, pack), ctx.hook]), section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => ({
    confession: confession(ctx, pack),
    denial: denial(ctx, pack),
    deeper: deeper(ctx, pack),
    sections: plan.sections.length,
    summary: `confesses "${confession(ctx, pack)}", denies it with "${denial(ctx, pack)}", then admits "${deeper(ctx, pack)}"`,
  }),
};
