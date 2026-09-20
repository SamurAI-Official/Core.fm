/**
 * Agent: The Specific -> Universal.
 *
 * Engine: tiny physical detail -> emotional implication -> larger human truth.
 *
 * The song starts with something mundane enough to be unremarkable, lets it imply its own meaning,
 * and only then allows the wider statement - never the other way round. "Love is temporary" is
 * abstract; "your toothbrush is still next to mine" is a song, and this style is the rule that
 * keeps the order that way.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { oncePrimitive, stageLines, uniq } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

function implication(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'implication', 'specific-universal:implication') ?? ctx.metaphor;
}

function universal(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'universal', 'specific-universal:universal') ?? ctx.hook;
}

export const specificUniversalAgent: WritingAgent = {
  id: 'specific-universal',
  name: 'The Specific → Universal',
  engine: ['tiny physical detail', 'emotional implication', 'larger human truth'],
  blurb:
    'A small, concrete thing, then what it implies, then the wider truth it was standing in for - in that order, because starting with the truth is how a lyric gets abstract.',
  needs: ['implication', 'universal'],
  repetition: 'fault',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['detail (mundane)'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['detail', 'refrain'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['detail (sharper)'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['detail', 'refrain'], lines: 3, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['implication'], lines: 2, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['larger truth'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'a physical detail, the meaning it implies, and only then the larger truth it was standing in for',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'verse-1':
        return takeLines(uniq(stageLines(pack, ctx, 'metaphor', 2).concat(stageLines(pack, ctx, 'perspective', 1))), section.lines);

      case 'verse-2':
        return takeLines(uniq([...stageLines(pack, ctx, 'perspective', 1), implication(ctx, pack)]), section.lines);

      case 'bridge':
        return takeLines(uniq([implication(ctx, pack), stageLines(pack, ctx, 'uncertainty', 1)[0] ?? ctx.hook]), section.lines);

      case 'outro':
        // The wider statement last, once the detail has earned it.
        return takeLines(uniq([universal(ctx, pack), ctx.hook]), section.lines);

      case 'chorus':
      default:
        return takeLines(uniq([...stageLines(pack, ctx, 'metaphor', 1), ctx.hook]), section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => ({
    implication: implication(ctx, pack),
    universal: universal(ctx, pack),
    sections: plan.sections.length,
    summary: `a physical detail, implying "${implication(ctx, pack)}", and only then "${universal(ctx, pack)}"`,
  }),
};
