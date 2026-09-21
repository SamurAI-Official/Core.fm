/**
 * Agent: The Groove -> Disruption -> Return (arrangement-only).
 *
 * Engine: pattern -> repetition -> disruption -> return.
 *
 * The hook is the pattern and it is repeated until it is predictable; one stripped-back line
 * breaks it; then the pattern comes back byte-identical, which is what makes the return feel
 * earned rather than merely repeated. The musical half of this engine belongs to the model,
 * so the style also carries its intent into the style prompt as a hint.
 */
import { takeLines, type LanguagePack, type LyricContext } from '../lyrics/types.js';
import { estimateSyllables } from '../lyrics/validate.js';
import { onceLine, optionalPrimitive, stageLines, withoutLine } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

/**
 * Shortest the break may be.
 *
 * The validator's comfortable band starts at half the target (~4.3 syllables at 112 BPM), so a
 * two-syllable break scores as a meter failure even though it reads exactly as intended. This
 * floor keeps the disruption short without letting it fall out of the song's meter.
 */
const MIN_BREAK_SYLLABLES = 5;

/**
 * The break, drawn once per song.
 *
 * Drawn once because it is reported as well as rendered: two independent draws would let the
 * manifest name a line the lyric never sings. Shortest-that-still-fits, because the break has
 * to read as stripped back *and* stay inside the singable band - the very shortest line in a
 * bank is often too short to sit on the bar.
 */
function breakLine(ctx: LyricContext, pack: LanguagePack): string {
  return onceLine(
    ctx,
    'groove-return:break',
    () => {
      const fragment = optionalPrimitive(pack, 'fragment')[0];
      if (fragment) return fragment;
      const candidates = stageLines(pack, ctx, 'contradiction', 4);
      const ascending = [...candidates].sort(
        (a, b) => estimateSyllables(a, pack.script) - estimateSyllables(b, pack.script),
      );
      const roomy = ascending.find((line) => estimateSyllables(line, pack.script) >= MIN_BREAK_SYLLABLES);
      return roomy ?? ascending[ascending.length - 1];
    },
    ctx.hook,
  );
}

export const grooveReturnAgent: WritingAgent = {
  id: 'groove-return',
  name: 'The Groove → Disruption → Return',
  engine: ['pattern', 'repetition', 'disruption', 'return'],
  blurb:
    'The hook becomes predictable, one stripped line breaks it, and then the pattern returns exactly as it was. The return works because the listener has learned the pattern, not because the words changed.',
  needs: [],
  repetition: 'device',
  styleHints: ['breakdown before the final chorus, then the main groove returns'],

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['pattern', 'context'], lines: 3, variant: 'verse-1' },
      // The pattern once per chorus, not three times: with the pattern also opening the verse and
      // closing the song, three per chorus made one line 53% of the lyric. The predictability the
      // engine needs comes from the pattern returning at all, and from the two turns under it.
      { section: 'Chorus', roles: ['pattern', 'turn'], lines: 3, variant: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Verse 2', roles: ['context (image)'], lines: 2, variant: 'verse-2' });
    }
    // The break: one line, no hook, nothing to lean on.
    sections.push({ section: 'Bridge', roles: ['disruption'], lines: 1, variant: 'break' });
    sections.push({ section: 'Chorus', roles: ['pattern', 'turn'], lines: 3, repeatOf: 'chorus' });
    sections.push({ section: 'Outro', roles: ['pattern (naked)'], lines: 1, variant: 'outro' });

    return {
      sections,
      summary: 'the hook is repeated until it is predictable, one stripped line breaks it, and the hook returns unchanged',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'verse-1':
        return takeLines([ctx.hook, ...stageLines(pack, ctx, 'perspective', 2)], section.lines);

      case 'verse-2':
        return takeLines(stageLines(pack, ctx, 'metaphor', 2), section.lines);

      case 'break':
        // Deliberately alone and short: the disruption is the silence around it.
        return takeLines([breakLine(ctx, pack)], section.lines);

      case 'outro':
        // After the break, the hook with nothing else in the way.
        return takeLines([ctx.hook], section.lines);

      case 'chorus':
      default:
        return takeLines(
          [ctx.hook, ...withoutLine(stageLines(pack, ctx, 'contradiction', 3), ctx.hook)],
          section.lines,
        );
    }
  },

  report: (ctx, plan, pack): AgentReport => ({
    breakLine: breakLine(ctx, pack),
    breakAt: plan.sections.findIndex((entry) => entry.variant === 'break') + 1,
    summary: `the hook repeats, then "${breakLine(ctx, pack)}" breaks it, and the chorus returns word-for-word`,
  }),
};
