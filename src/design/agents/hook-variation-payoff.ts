/**
 * Agent: Hook -> Variation -> Payoff.
 *
 * Engine: claim -> repetition -> contradiction -> reinterpretation -> return.
 *
 * The hook is the claim. It is stated, repeated until it is a hook, then one line changes what it
 * means, and the hook returns carrying the new meaning. The listener hears the same words twice
 * and understands them differently - which is the strongest pop mechanism there is, and the
 * reason this style marks repetition as a device rather than a fault.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { oncePrimitive, stageLines, uniq, withoutLine } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

/** The line that re-reads the hook, drawn once per song. */
function reinterpretation(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'implication', 'hvp:reinterpretation') ?? ctx.metaphor;
}

export const hookVariationPayoffAgent: WritingAgent = {
  id: 'hook-variation-payoff',
  name: 'Hook → Variation → Payoff',
  engine: ['claim', 'repetition', 'contradiction', 'reinterpretation', 'return'],
  blurb:
    'The hook stated, repeated, then re-read by a single line, and returned carrying the new meaning. Same words, different understanding.',
  needs: ['implication'],
  repetition: 'device',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Intro', roles: ['claim (bare)'], lines: 1, variant: 'intro' },
      // The verses set the scene the claim will be heard in; the claim itself arrives with the
      // chorus, so that hearing it again is an event rather than the default.
      { section: 'Verse 1', roles: ['context'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['claim', 'reinterpretation', 'turn'], lines: 4, variant: 'chorus' },
      { section: 'Verse 2', roles: ['context'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['claim', 'reinterpretation', 'turn'], lines: 4, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['variation (alone)', 'claim'], lines: 2, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['claim (payoff)'], lines: 1, variant: 'outro' });
    return {
      sections,
      summary: 'the claim repeated until it is a hook, re-read once by a single line, and returned carrying the new meaning',
    };
  },

  write: (section, ctx, pack) => {
    const variation = reinterpretation(ctx, pack);
    switch (section.variant) {
      case 'intro':
      case 'outro':
        return takeLines([ctx.hook], section.lines);

      case 'verse-1':
        return takeLines(uniq(withoutLine(stageLines(pack, ctx, 'perspective', 3), ctx.hook)), section.lines);

      case 'verse-2':
        return takeLines(uniq(withoutLine(stageLines(pack, ctx, 'uncertainty', 3), ctx.hook)), section.lines);

      case 'bridge':
        // The variation alone, then the claim again: the re-read, then the words.
        return takeLines(uniq([variation, ctx.hook]), section.lines);

      case 'chorus':
      default:
        // The claim, the line that re-reads it, and the turns that come off it. This was
        // `[claim, claim, variation]` in every section of the song, which measured as one line
        // being 56% of the lyric and only six distinct lines in sixteen.
        return takeLines(
          uniq([ctx.hook, variation, ...withoutLine(stageLines(pack, ctx, 'contradiction', 2), ctx.hook)]),
          section.lines,
        );
    }
  },

  report: (ctx, plan, pack): AgentReport => ({
    claim: ctx.hook,
    reinterpretation: reinterpretation(ctx, pack),
    statements: plan.sections.filter((entry) => entry.roles.some((role) => role.startsWith('claim'))).length,
    summary: `"${ctx.hook}" repeated, then re-read by "${reinterpretation(ctx, pack)}", then returned`,
  }),
};
