/**
 * Agent: The Call -> Response -> Escalation.
 *
 * Engine: statement -> response -> repetition -> variation -> escalation.
 *
 * A lead line and a fixed answer, repeated until the listener can sing the answer before it
 * arrives - and then the escalation, where the answer changes because the singer has changed. The
 * response is byte-identical every time until that final break, which is what makes participation
 * automatic and the break audible.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { onceLine, oncePrimitive, stageLines, uniq } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

/** The fixed answer: one line, sung the same way under every call. */
function response(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'answer', 'call-response:response') ?? ctx.hook;
}

function call(ctx: LyricContext, pack: LanguagePack, index: number): string {
  return oncePrimitive(ctx, pack, 'question', `call-response:call${index}`, index) ?? ctx.hook;
}

function escalation(ctx: LyricContext, pack: LanguagePack): string {
  // The answer that changes: the singer takes it over instead of waiting for it. Drawn once,
  // because the report names it and the outro sings it.
  return onceLine(ctx, 'call-response:escalation', () => stageLines(pack, ctx, 'agency', 1)[0], ctx.hook);
}

export const callResponseAgent: WritingAgent = {
  id: 'call-response',
  name: 'The Call → Response → Escalation',
  engine: ['statement', 'response', 'repetition', 'variation', 'escalation'],
  blurb:
    'A call and a fixed answer, repeated until the answer is predictable, and then a different answer at the end. The audience joins in without being asked.',
  needs: ['question', 'answer'],
  repetition: 'device',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['call', 'response'], lines: 2, variant: 'verse-1' },
      { section: 'Chorus', roles: ['call', 'response', 'call', 'response'], lines: 4, variant: 'chorus' },
      { section: 'Verse 2', roles: ['call', 'response'], lines: 2, variant: 'verse-2' },
      { section: 'Chorus', roles: ['call', 'response', 'call', 'response'], lines: 4, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['call'], lines: 1, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['call', 'escalation'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'a call answered the same way every time, then answered differently once the singer stops waiting',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'verse-1':
        return takeLines(uniq([call(ctx, pack, 0), response(ctx, pack)]), section.lines);

      case 'verse-2':
        return takeLines(uniq([call(ctx, pack, 3), response(ctx, pack)]), section.lines);

      case 'bridge':
        return takeLines([call(ctx, pack, 4)], section.lines);

      case 'outro':
        // The escalation: the same shape, a different answer.
        return takeLines(uniq([call(ctx, pack, 5), escalation(ctx, pack)]), section.lines);

      case 'chorus':
      default:
        // A strict alternation, so the response is predictable by the second bar.
        return takeLines([call(ctx, pack, 1), response(ctx, pack), call(ctx, pack, 2), response(ctx, pack)], section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => ({
    response: response(ctx, pack),
    calls: [0, 1, 2, 3, 4, 5].map((index) => call(ctx, pack, index)),
    escalation: escalation(ctx, pack),
    sections: plan.sections.length,
    summary: `"${call(ctx, pack, 0)}" answered "${response(ctx, pack)}" every time, until "${escalation(ctx, pack)}"`,
  }),
};
