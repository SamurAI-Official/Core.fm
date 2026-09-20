/**
 * Agent: The Promise -> Violation -> Repetition.
 *
 * Engine: expectation -> anticipation -> violation -> recognition.
 *
 * "I said I'd never..." and then the song does exactly that. The claim is stated plainly, the
 * hook builds the expectation, the reversal breaks it, and the recognition names what the
 * listener has already worked out.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { oncePrimitive, stageLines, uniq } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

function promise(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'claim', 'promise-violation:promise') ?? ctx.hook;
}

function violation(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'reversal', 'promise-violation:violation') ?? ctx.hook;
}

export const promiseViolationAgent: WritingAgent = {
  id: 'promise-violation',
  name: 'The Promise → Violation → Repetition',
  engine: ['expectation', 'anticipation', 'violation', 'recognition'],
  blurb:
    'A promise is made plainly, the hook holds the expectation, and then the song does the thing it said it never would. Songwriting\'s jump cut.',
  needs: ['claim', 'reversal'],
  repetition: 'fault',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['promise', 'context'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['anticipation'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['violation'], lines: 2, variant: 'verse-2' },
      { section: 'Chorus', roles: ['anticipation'], lines: 3, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['recognition'], lines: 2, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['violation (again)'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'a promise, the tension of waiting, the act that breaks it, and the recognition of what that means',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'verse-1':
        return takeLines(uniq([promise(ctx, pack), ...stageLines(pack, ctx, 'perspective', 2)]), section.lines);

      case 'verse-2':
        return takeLines(uniq([violation(ctx, pack), stageLines(pack, ctx, 'uncertainty', 1)[0] ?? ctx.hook]), section.lines);

      case 'bridge':
        return takeLines(
          uniq([stageLines(pack, ctx, 'conclusion', 1)[0] ?? ctx.hook, pack.reframe(ctx.hook, ctx.qualifier)]),
          section.lines,
        );

      case 'outro':
        return takeLines(uniq([violation(ctx, pack), stageLines(pack, ctx, 'conclusion', 1)[0] ?? ctx.hook]), section.lines);

      case 'chorus':
      default:
        // The expectation, held: the hook twice and the promise underneath it.
        return takeLines(uniq([ctx.hook, ctx.hook, promise(ctx, pack)]), section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => ({
    promise: promise(ctx, pack),
    violation: violation(ctx, pack),
    sections: plan.sections.length,
    summary: `promises "${promise(ctx, pack)}" and breaks it with "${violation(ctx, pack)}" across ${plan.sections.length} sections`,
  }),
};
