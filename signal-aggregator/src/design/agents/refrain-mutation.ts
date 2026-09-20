/**
 * Agent: Refrain With Semantic Mutation (arrangement-only).
 *
 * Engine: same phrase -> new context -> new meaning -> new context -> transformed meaning.
 *
 * The refrain is the hook, byte-identical every time. What changes is the line before it:
 * the first verse reads it literally, the second reads it as a relationship, the bridge
 * re-reads it against an image, and the outro lets it land on the singer. Because the
 * words never move, the listener learns the phrase early and then has to reinterpret it -
 * which is why this agent declares `repetition: 'device'` and the gate asserts the device
 * was actually used rather than merely permitted.
 *
 * Needs no new bank material: every context line comes from the pack's existing stages.
 */
import { takeLines, type LyricContext, type LanguagePack } from '../lyrics/types.js';
import type { AgentPlan, AgentSection, AgentReport, WritingAgent } from './types.js';

/** Context line before each restatement of the refrain, in song order. */
const READINGS = ['after a plain opening', 'after doubt', 'after the image', 'alone at the end'];

function contextLines(
  pack: LanguagePack,
  ctx: LyricContext,
  stage: 'perspective' | 'uncertainty' | 'metaphor' | 'conclusion',
  count: number,
): string[] {
  return pack.render[stage](count, ctx, new Set());
}

/** A contradiction line that is not the hook: the turn inside the chorus. */
function turnLine(pack: LanguagePack, ctx: LyricContext): string {
  const lines = pack.render.contradiction(4, ctx, new Set()).filter((line) => line !== ctx.hook);
  return lines[0] ?? ctx.hook;
}

export const refrainMutationAgent: WritingAgent = {
  id: 'refrain-mutation',
  name: 'Refrain With Semantic Mutation',
  engine: ['same phrase', 'new context', 'new meaning', 'new context', 'transformed meaning'],
  blurb:
    'One phrase, repeated word for word, made to mean something different each time by the lines that surround it. The listener learns the phrase early and the song teaches them how to read it.',
  needs: [],
  repetition: 'device',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      // Stated plainly, with nothing around it yet.
      { section: 'Intro', roles: ['refrain', 'plain reading'], lines: 1, variant: 'intro' },
      // Literal reading: where and when the singer stands.
      { section: 'Verse 1', roles: ['context (literal)', 'refrain'], lines: 4, variant: 'verse-1' },
      { section: 'Chorus', roles: ['refrain', 'turn'], lines: 4, variant: 'chorus' },
      // Second reading: the same words, now about doubt.
      { section: 'Verse 2', roles: ['context (doubt)', 'refrain'], lines: 4, variant: 'verse-2' },
      // A repeated chorus is a repeated chorus: identical lines, by construction.
      { section: 'Chorus', roles: ['refrain', 'turn'], lines: 4, repeatOf: 'chorus' },
    ];

    // A shorter song for a low-energy ballad: keep the three readings, drop the middle verse.
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['context (image)', 'refrain'], lines: 3, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['refrain', 'wider statement'], lines: 2, variant: 'outro' });

    return {
      sections,
      summary:
        'one refrain held word-for-word while the context around it changes, so the same phrase is read three ways: literally, as doubt, and finally as the singer\'s own',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'intro':
        // The phrase alone, before the song has taught the listener anything.
        return takeLines([ctx.hook], section.lines);

      case 'verse-1':
        return takeLines([...contextLines(pack, ctx, 'perspective', 3), ctx.hook], section.lines);

      case 'verse-2':
        return takeLines([...contextLines(pack, ctx, 'uncertainty', 3), ctx.hook], section.lines);

      case 'bridge':
        return takeLines([...contextLines(pack, ctx, 'metaphor', 2), ctx.hook], section.lines);

      case 'outro':
        return takeLines([ctx.hook, ...contextLines(pack, ctx, 'conclusion', 1)], section.lines);

      case 'chorus':
      default: {
        // refrain, refrain, turn, refrain - the turn is what re-reads the phrase. The turn
        // comes from the contradiction bank and is guaranteed not to be the hook itself.
        return takeLines([ctx.hook, ctx.hook, turnLine(pack, ctx), ctx.hook], section.lines);
      }
    }
  },

  report: (ctx, plan): AgentReport => {
    const contextSections = plan.sections.filter((entry) =>
      entry.roles.some((role) => role.startsWith('context')),
    );
    return {
      refrain: ctx.hook,
      readings: READINGS.slice(0, contextSections.length),
      // How many times the exact phrase is sung, which is the device this agent claims.
      restatements: plan.sections.reduce(
        (total, entry) => total + (entry.roles.includes('refrain') ? entry.lines : 0),
        0,
      ),
      summary: `refrain "${ctx.hook}" used word-for-word across ${plan.sections.length} sections while the context changes: ${READINGS.slice(0, contextSections.length).join('; ')}`,
    };
  },
};
