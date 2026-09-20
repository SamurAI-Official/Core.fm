/**
 * Agent: The Countdown.
 *
 * Engine: deadline -> progression -> decreasing time -> decision.
 *
 * A finite amount of time (or money) is named early, and the song keeps losing it until somebody
 * has to decide. Humans are absurdly sensitive to a clock, so the escalation does the work the
 * listener would otherwise have to be told about.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { onceLine, oncePrimitive, stageLines, uniq } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

function deadline(ctx: LyricContext, pack: LanguagePack, index: number): string {
  return oncePrimitive(ctx, pack, 'deadline', `countdown:deadline${index}`, index) ?? ctx.hook;
}

function obstacle(ctx: LyricContext, pack: LanguagePack, index: number): string {
  return oncePrimitive(ctx, pack, 'ladder', `countdown:obstacle${index}`, index) ?? ctx.hook;
}

function decision(ctx: LyricContext, pack: LanguagePack): string {
  // The pack's agency line is the decision: "그만 기다리기로 했어" / "I'm done waiting on the weather".
  return onceLine(ctx, 'countdown:decision', () => stageLines(pack, ctx, 'agency', 1)[0], ctx.hook);
}

export const countdownAgent: WritingAgent = {
  id: 'countdown',
  name: 'The Countdown',
  engine: ['deadline', 'progression', 'decreasing time', 'decision'],
  blurb:
    'A finite amount of something is named at the top, and the song spends it. The invisible clock makes the last line a decision rather than a mood.',
  needs: ['deadline', 'ladder'],
  repetition: 'fault',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Intro', roles: ['deadline (named)'], lines: 1, variant: 'intro' },
      { section: 'Verse 1', roles: ['clock', 'obstacle'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['refrain', 'obstacle'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['obstacle'], lines: 2, variant: 'verse-2' },
      { section: 'Chorus', roles: ['refrain', 'obstacle'], lines: 3, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['clock (running out)'], lines: 2, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['decision'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'a named limit, the time being spent, and a decision taken once it is nearly gone',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'intro':
        return takeLines([deadline(ctx, pack, 0)], section.lines);

      case 'verse-1':
        return takeLines(uniq([deadline(ctx, pack, 1), obstacle(ctx, pack, 0)]), section.lines);

      case 'verse-2':
        return takeLines(uniq([obstacle(ctx, pack, 3), stageLines(pack, ctx, 'perspective', 1)[0] ?? ctx.hook]), section.lines);

      case 'bridge':
        return takeLines(uniq([deadline(ctx, pack, 2), obstacle(ctx, pack, 4)]), section.lines);

      case 'outro':
        // The clock beats the song: somebody decides.
        return takeLines(uniq([decision(ctx, pack), stageLines(pack, ctx, 'conclusion', 1)[0] ?? ctx.hook]), section.lines);

      case 'chorus':
      default:
        return takeLines(uniq([ctx.hook, obstacle(ctx, pack, 1), obstacle(ctx, pack, 2)]), section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => ({
    deadline: deadline(ctx, pack, 0),
    obstacles: [0, 1, 2, 3, 4].map((index) => obstacle(ctx, pack, index)),
    decision: decision(ctx, pack),
    sections: plan.sections.length,
    summary: `"${deadline(ctx, pack, 0)}" against the clock, deciding "${decision(ctx, pack)}"`,
  }),
};
