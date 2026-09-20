/**
 * Agent: The "I Thought X / Actually Y".
 *
 * Engine: belief -> evidence -> contradiction -> revised belief.
 *
 * One of the most reliable reversals there is: the singer believes something, the song shows them
 * the evidence, and the belief is replaced by a truer one. The revision is a claim the song has
 * not used yet, so it cannot simply restate the belief.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { oncePrimitive, stageLines, uniq } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

function belief(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'claim', 'thought-actually:belief') ?? ctx.hook;
}

function contradiction(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'reversal', 'thought-actually:contradiction') ?? ctx.hook;
}

function revised(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'claim', 'thought-actually:revised', 1) ?? ctx.hook;
}

export const thoughtActuallyAgent: WritingAgent = {
  id: 'thought-actually',
  name: 'The "I Thought X / Actually Y"',
  engine: ['belief', 'evidence', 'contradiction', 'revised belief'],
  blurb:
    'The singer says what they thought, the song shows what was actually true, and the belief is replaced. A reversal that costs the character something to admit.',
  needs: ['claim', 'reversal'],
  repetition: 'fault',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['belief'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['contradiction', 'refrain'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['evidence'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['contradiction', 'refrain'], lines: 3, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['revised belief'], lines: 2, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['revised belief (alone)'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'a stated belief, the evidence against it, and the belief that replaces it',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'verse-1':
        return takeLines(uniq([belief(ctx, pack), ...stageLines(pack, ctx, 'perspective', 1)]), section.lines);

      case 'verse-2':
        return takeLines(uniq([...stageLines(pack, ctx, 'metaphor', 1), contradiction(ctx, pack)]), section.lines);

      case 'bridge':
        return takeLines(uniq([revised(ctx, pack), stageLines(pack, ctx, 'conclusion', 1)[0] ?? ctx.hook]), section.lines);

      case 'outro':
        return takeLines(uniq([revised(ctx, pack), ctx.hook]), section.lines);

      case 'chorus':
      default:
        // The contradiction, then the hook while it sinks in.
        return takeLines(uniq([contradiction(ctx, pack), ctx.hook]), section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => ({
    belief: belief(ctx, pack),
    contradiction: contradiction(ctx, pack),
    revised: revised(ctx, pack),
    sections: plan.sections.length,
    summary: `thought "${belief(ctx, pack)}", then "${contradiction(ctx, pack)}", so now "${revised(ctx, pack)}"`,
  }),
};
