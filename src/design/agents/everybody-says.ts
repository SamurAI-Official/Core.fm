/**
 * Agent: The "Everybody Says -> I Say".
 *
 * Engine: common belief -> personal evidence -> contradiction -> personal conclusion.
 *
 * The song starts with something everyone agrees on, tests it against lived experience, and ends
 * with a conclusion the singer earned rather than inherited. Nobody is lectured: the character
 * tests the proposition and reports back.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { oncePrimitive, stageLines, uniq } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

function commonBelief(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'claim', 'everybody-says:belief', 2) ?? ctx.hook;
}

function counterEvidence(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'reversal', 'everybody-says:contradiction') ?? ctx.hook;
}

function personalConclusion(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'universal', 'everybody-says:conclusion') ?? ctx.hook;
}

export const everybodySaysAgent: WritingAgent = {
  id: 'everybody-says',
  name: 'The "Everybody Says → I Say"',
  engine: ['common belief', 'personal evidence', 'contradiction', 'personal conclusion'],
  blurb:
    'Starts where the culture agrees, tests it against what actually happened, and ends somewhere the singer can defend. The argument is made by a character, not by the song.',
  needs: ['claim', 'reversal', 'universal'],
  repetition: 'fault',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Intro', roles: ['common belief'], lines: 1, variant: 'intro' },
      { section: 'Verse 1', roles: ['evidence'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['contradiction', 'refrain'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['evidence (image)'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['contradiction', 'refrain'], lines: 3, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['personal conclusion'], lines: 2, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['common belief (answered)'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'the received wisdom, the evidence against it, and the conclusion the singer actually holds',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'intro':
        return takeLines([commonBelief(ctx, pack)], section.lines);

      case 'verse-1':
        return takeLines(uniq(stageLines(pack, ctx, 'perspective', 2)), section.lines);

      case 'verse-2':
        return takeLines(uniq(stageLines(pack, ctx, 'metaphor', 2)), section.lines);

      case 'bridge':
        return takeLines(uniq([personalConclusion(ctx, pack), ctx.hook]), section.lines);

      case 'outro':
        return takeLines(uniq([commonBelief(ctx, pack), personalConclusion(ctx, pack)]), section.lines);

      case 'chorus':
      default:
        // The belief held up against the evidence, with the hook as the refusal to let it go.
        return takeLines(uniq([ctx.hook, counterEvidence(ctx, pack)]), section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => ({
    belief: commonBelief(ctx, pack),
    contradiction: counterEvidence(ctx, pack),
    conclusion: personalConclusion(ctx, pack),
    sections: plan.sections.length,
    summary: `"${commonBelief(ctx, pack)}" tested against "${counterEvidence(ctx, pack)}", concluding "${personalConclusion(ctx, pack)}"`,
  }),
};
