/**
 * Agent: The Listener as the Missing Character (arrangement-only).
 *
 * Engine: evidence -> omission -> listener inference -> realisation.
 *
 * The song shows what happened and never says why. Everything is observable detail and
 * second-hand fact, so the listener assembles the cause themselves - which is what makes a
 * lyric feel intelligent instead of explained. The gate checks the omission structurally:
 * evidence lines must be present, and no line may come from the packs' explicit-statement
 * banks (`claim`, `universal`) when those exist.
 */
import { takeLines } from '../lyrics/types.js';
import { stageLines } from './shared.js';
import type { AgentReport, AgentSection, WritingAgent } from './types.js';

export const missingCharacterAgent: WritingAgent = {
  id: 'missing-character',
  name: 'The Listener as the Missing Character',
  engine: ['evidence', 'omission', 'listener inference', 'realisation'],
  blurb:
    'What happened is shown and why is withheld. The song deals only in things that can be seen or quoted, and the listener is left to name the cause - which is what makes a lyric feel clever without becoming complicated.',
  needs: [],
  repetition: 'fault',

  plan: ({ energy }) => {
    const sections: AgentSection[] = [
      { section: 'Verse 1', roles: ['evidence (scene)'], lines: 3, variant: 'verse-1' },
      { section: 'Chorus', roles: ['refrain', 'evidence (object)'], lines: 3, variant: 'chorus' },
      { section: 'Verse 2', roles: ['evidence (behaviour)'], lines: 3, variant: 'verse-2' },
      { section: 'Chorus', roles: ['refrain', 'evidence (object)'], lines: 3, repeatOf: 'chorus' },
    ];
    if (energy >= 0.45) {
      sections.push({ section: 'Bridge', roles: ['evidence (absence)'], lines: 2, variant: 'bridge' });
    }
    sections.push({ section: 'Outro', roles: ['refrain', 'unstated'], lines: 2, variant: 'outro' });
    return {
      sections,
      summary: 'evidence only: what can be seen, quoted or noticed, with the cause left out so the listener has to name it',
    };
  },

  write: (section, ctx, pack) => {
    switch (section.variant) {
      case 'verse-1':
        return takeLines(stageLines(pack, ctx, 'perspective', 3), section.lines);

      case 'verse-2':
        return takeLines([...stageLines(pack, ctx, 'uncertainty', 2), ...stageLines(pack, ctx, 'metaphor', 1)], section.lines);

      case 'bridge':
        // An absence is evidence too, and it is the kind that says the most.
        return takeLines(stageLines(pack, ctx, 'metaphor', 2), section.lines);

      case 'outro':
        return takeLines([ctx.hook, stageLines(pack, ctx, 'conclusion', 1)[0] ?? ctx.hook], section.lines);

      case 'chorus':
      default:
        return takeLines([ctx.hook, ...stageLines(pack, ctx, 'metaphor', 2)], section.lines);
    }
  },

  report: (_ctx, plan): AgentReport => ({
    withheld: 'the cause: nothing in the lyric states why it happened',
    evidenceSections: plan.sections
      .filter((entry) => entry.roles.some((role) => role.startsWith('evidence')))
      .map((entry) => entry.section),
    summary:
      'what happened is shown and why is withheld, so the listener has to supply the missing character themselves',
  }),
};
