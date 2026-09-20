/**
 * Agent: The False Resolution.
 *
 * Engine: conflict -> apparent resolution -> destabilising detail -> new conflict.
 *
 * The song hands the listener an ending - a decisive line, the kind that closes a song - and then
 * one detail takes it back and the song has another dimension. The reversal is drawn from the
 * pack's reversal bank, so the undercut is a real line rather than a contradiction of the style's
 * own making.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { onceLine, oncePrimitive, stageLines, uniq } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

function resolution(ctx: LyricContext, pack: LanguagePack): string {
  // A decisive line: the agency stage is where the pack says "I'm done waiting on the weather".
  // Drawn once, because the report names it and a second draw would name a different line.
  return onceLine(ctx, 'false-resolution:resolution', () => stageLines(pack, ctx, 'agency', 1)[0], ctx.hook);
}

function destabiliser(ctx: LyricContext, pack: LanguagePack): string {
  return oncePrimitive(ctx, pack, 'reversal', 'false-resolution:destabiliser') ?? stageLines(pack, ctx, 'uncertainty', 1)[0] ?? ctx.hook;
}

export const falseResolutionAgent: WritingAgent = {
  id: 'false-resolution',
  name: 'The False Resolution',
  engine: ['conflict', 'apparent resolution', 'destabilising detail', 'new conflict'],
  blurb:
    'Sounds like the ending, then is not: a decisive line, a beat, and a detail that takes it back. The song gains a dimension exactly where it seemed to close.',
  needs: ['reversal'],
  repetition: 'fault',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['conflict'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['conflict', 'apparent resolution'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['conflict (image)'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['conflict', 'apparent resolution'], lines: 3, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['destabilising detail'], lines: 2, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['new conflict'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'an apparent ending, then one detail that takes it back and leaves the song open again',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'verse-1':
        return takeLines(uniq([...stageLines(pack, ctx, 'uncertainty', 2), ctx.hook]), section.lines);

      case 'verse-2':
        return takeLines(uniq([...stageLines(pack, ctx, 'metaphor', 2), ctx.hook]), section.lines);

      case 'bridge':
        // The beat is the short first line; the detail lands after it.
        return takeLines(uniq([pack.reframe(ctx.hook, ctx.qualifier), destabiliser(ctx, pack)]), section.lines);

      case 'outro':
        return takeLines(uniq([destabiliser(ctx, pack), stageLines(pack, ctx, 'conclusion', 1)[0] ?? ctx.hook]), section.lines);

      case 'chorus':
      default:
        // Conflict, then something that sounds like the end of the argument.
        return takeLines(uniq([ctx.hook, resolution(ctx, pack)]), section.lines);
    }
  },

  report: (ctx, plan, pack): AgentReport => ({
    resolution: resolution(ctx, pack),
    destabiliser: destabiliser(ctx, pack),
    resolutionSection: plan.sections.findIndex((entry) => entry.roles.includes('apparent resolution')) + 1,
    summary: `resolves with "${resolution(ctx, pack)}", then takes it back with "${destabiliser(ctx, pack)}"`,
  }),
};
