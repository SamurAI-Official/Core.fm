/**
 * Agent: The Character -> Choice -> Consequence.
 *
 * Engine: person -> desire -> dilemma -> choice -> consequence -> realisation.
 *
 * The listener becomes curious about a consequence only when somebody chose it. This style gives
 * the singer a want, puts it against a dilemma, lets them decide out loud (the pack's agency
 * lines), and then shows what the decision cost.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { onceLine, oncePrimitive, stageLines, uniq } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

function desire(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'claim', 'character-choice:desire') ?? ctx.hook;
}

function choice(ctx: LyricContext, pack: LanguagePack): string {
  return onceLine(ctx, 'character-choice:choice', () => stageLines(pack, ctx, 'agency', 1)[0], ctx.hook);
}

function consequence(ctx: LyricContext, pack: LanguagePack): string {
  return onceLine(
    ctx,
    'character-choice:consequence',
    () => stageLines(pack, ctx, 'conclusion', 1)[0],
    ctx.hook,
  );
}

function dilemma(ctx: LyricContext, pack: LanguagePack): string {
  // Drawn once: reported as well as rendered, and two draws would disagree.
  return onceLine(ctx, 'character-choice:dilemma', () => stageLines(pack, ctx, 'contradiction', 1)[0], ctx.hook);
}

export const characterChoiceAgent: WritingAgent = {
  id: 'character-choice',
  name: 'The Character → Choice → Consequence',
  engine: ['person', 'desire', 'dilemma', 'choice', 'consequence', 'realisation'],
  blurb:
    'Someone wants something, is put in front of a decision, chooses out loud, and then has to live with it. Agency is the whole engine: something merely happening to a character is not a story.',
  needs: ['claim'],
  repetition: 'fault',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['person', 'desire'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['dilemma', 'refrain'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['choice'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['dilemma', 'refrain'], lines: 3, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['consequence'], lines: 2, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['realisation'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'a want, a dilemma, a decision taken out loud, and the consequence that follows it',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'verse-1':
        return takeLines(uniq([...stageLines(pack, ctx, 'perspective', 1), desire(ctx, pack)]), section.lines);

      case 'verse-2':
        // The choice, made twice: a decision the listener watches being taken.
        return takeLines(uniq([choice(ctx, pack), ...stageLines(pack, ctx, 'agency', 1)]), section.lines);

      case 'bridge':
        return takeLines(uniq([consequence(ctx, pack), stageLines(pack, ctx, 'uncertainty', 1)[0] ?? ctx.hook]), section.lines);

      case 'outro':
        return takeLines(uniq([consequence(ctx, pack), ctx.hook]), section.lines);

      case 'chorus':
      default:
        // The dilemma: the centre of the decision, then the hook.
        return takeLines(uniq([dilemma(ctx, pack), ctx.hook]), section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => ({
    desire: desire(ctx, pack),
    dilemma: dilemma(ctx, pack),
    choice: choice(ctx, pack),
    consequence: consequence(ctx, pack),
    sections: plan.sections.length,
    summary: `wants "${desire(ctx, pack)}", chooses "${choice(ctx, pack)}", and lives with "${consequence(ctx, pack)}"`,
  }),
};
