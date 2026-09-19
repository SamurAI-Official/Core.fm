/**
 * English pack.
 *
 * Banks stay in `../lyricBanks.ts` (they are the original, richly populated set);
 * this pack owns the English templates and the English agreement rules. Keeping
 * the data where it was avoids churning verified content while moving all
 * *grammar* into the pack that is responsible for it.
 */
import {
  AGENCY_ACTIONS,
  AGENCY_CHOICES,
  AGENCY_PLANS,
  CONTRAST_ADJECTIVES,
  CONTRADICTION_PAIRS,
  DONE_GERUNDS,
  GERUNDS,
  HOOK_SUBJECTS,
  HOOK_VERBS,
  IN_PLACES,
  ON_PLACES,
  PERSPECTIVE_DETAILS,
  REFRAME_QUALIFIERS,
  SELVES,
  TIMES,
  UNCERTAIN_ACTIONS,
  UNCERTAIN_ADJECTIVES,
  UNCERTAIN_CLAUSES,
  UNRESOLVED_LINES,
  WIDE_ADJECTIVES,
  WIDE_GERUNDS,
  WIDE_PLURAL,
  WIDE_SINGULAR,
} from '../lyricBanks.js';
import { metaphorsFor } from '../imagery.js';
import { fromBank, pairFromBank, sentenceCase, takeLines, type LanguagePack, type LyricContext } from './types.js';

export const englishPack: LanguagePack = {
  code: 'en',
  label: 'English',
  nativeLabel: 'English',
  script: 'latin',
  complete: true,

  // Hook subjects are restricted to plural/first-person so the base-form verb
  // phrases always agree ("Late-night drive say it first" was the original bug).
  buildHook: (rng) => `${fromBank(rng, HOOK_SUBJECTS)} ${fromBank(rng, HOOK_VERBS)}`,

  // Number is chosen once so the subject and its verb cannot disagree.
  buildScale: (rng) => {
    const plural = rng() < 0.5;
    return plural
      ? { subject: fromBank(rng, WIDE_PLURAL), verb: 'are' }
      : { subject: fromBank(rng, WIDE_SINGULAR), verb: 'is' };
  },

  pickContradiction: (rng) => pairFromBank(rng, CONTRADICTION_PAIRS, new Set()),
  pickContrast: (rng) => pairFromBank(rng, CONTRAST_ADJECTIVES, new Set()),
  pickQualifier: (rng) => fromBank(rng, REFRAME_QUALIFIERS),

  introLine: (ctx) => `(${ctx.topicWord ?? ctx.hook})`,
  reframe: (hook, qualifier) => `${hook}, ${qualifier}`,

  metaphors: (family) => metaphorsFor(family),

  render: {
    perspective: (count, ctx, used) => {
      const time = fromBank(ctx.rng, TIMES, used);
      // The preposition is bound to the bank the place came from, so "on a
      // rented room" is structurally impossible.
      const useOn = ctx.rng() < 0.5;
      const place = fromBank(ctx.rng, useOn ? ON_PLACES : IN_PLACES, used);
      const self = fromBank(ctx.rng, SELVES, used);
      const detail = fromBank(ctx.rng, PERSPECTIVE_DETAILS, used);
      return takeLines(
        [
          `It's ${time} ${useOn ? 'on' : 'in'} ${place}`,
          `I'm ${self}`,
          sentenceCase(detail),
          `${sentenceCase(place)}, ${detail}`,
        ],
        count,
      );
    },

    uncertainty: (count, ctx, used) => {
      return takeLines(
        [
          `I don't know if I ${fromBank(ctx.rng, UNCERTAIN_ACTIONS, used)}`,
          `Maybe we ${fromBank(ctx.rng, UNCERTAIN_CLAUSES, used)}`,
          `Nothing here is ${fromBank(ctx.rng, UNCERTAIN_ADJECTIVES, used)}`,
          `I keep ${fromBank(ctx.rng, GERUNDS, used)}`,
        ],
        count,
      );
    },

    agency: (count, ctx, used) => {
      return takeLines(
        [
          `So I ${fromBank(ctx.rng, AGENCY_ACTIONS, used)}`,
          `I'm gonna ${fromBank(ctx.rng, AGENCY_PLANS, used)}`,
          `This time I ${fromBank(ctx.rng, AGENCY_CHOICES, used)}`,
          `I'm done ${fromBank(ctx.rng, DONE_GERUNDS, used)}`,
        ],
        count,
      );
    },

    contradiction: (count, ctx) => {
      const [a, b] = ctx.contradiction;
      const [x, y] = ctx.contrast;
      return takeLines(
        [
          ctx.hook,
          `I ${a}, but I ${b}`,
          `I'm ${x}, still ${y}`,
          // Deliberately one side only. Stating both halves again here ("Part of me
          // wants to X, part of me wants to Y") ran to ~18 syllables against a
          // ~9-syllable budget, and the duality is already carried by line 2.
          `Part of me wants to ${a}`,
        ],
        count,
      );
    },

    // Line 2 answers the image rather than restating it, so a two-line metaphor
    // section does not simply repeat itself.
    metaphor: (count, ctx) => {
      return takeLines(
        [
          `There's ${ctx.metaphor}`,
          "And it's still the loudest thing here",
          `Everything points at ${ctx.metaphor}`,
        ],
        count,
      );
    },

    scale: (count, ctx, used) => {
      const subject = ctx.wideSubject;
      // Avoids "the whole city awake is awake tonight" by skipping adjectives
      // already present in the subject.
      const subjectWords = new Set(subject.toLowerCase().split(/\s+/));
      const pool = WIDE_ADJECTIVES.filter(
        (entry) => !entry.split(/\s+/).every((word) => subjectWords.has(word)),
      );
      const adjective = fromBank(ctx.rng, pool.length > 0 ? pool : WIDE_ADJECTIVES, used);
      return takeLines(
        [
          `It's not just me, it's ${subject}`,
          `${sentenceCase(subject)} ${ctx.wideVerb} ${adjective} tonight`,
          `We're all ${fromBank(ctx.rng, WIDE_GERUNDS, used)}`,
        ],
        count,
      );
    },

    conclusion: (count, ctx, used) => {
      if (ctx.conclusion === 'reframed') {
        return Array.from({ length: Math.min(count, 2) }, () => `(${englishPack.reframe(ctx.hook, ctx.qualifier)})`);
      }
      return takeLines(
        [fromBank(ctx.rng, UNRESOLVED_LINES, used), `Somewhere it's still ${fromBank(ctx.rng, TIMES, used)}`],
        count,
      );
    },
  },
};

export type { LyricContext };