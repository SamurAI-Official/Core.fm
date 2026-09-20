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
import {
  bankPicker,
  boundedReframe,
  fromBank,
  pairFromBank,
  sentenceCase,
  subjectAdlib,
  subjectIdsOf,
  subjectSelves,
  takeLines,
  type LanguagePack,
  type LyricContext,
  type SubjectTable,
} from './types.js';
import type { PrimitiveId } from './primitives.js';

/**
 * Subject material: what this pack writes when a song is about a specific thing.
 *
 * Every entry has to read correctly in the one template that consumes it, exactly as
 * the general banks do - subjects must not become a second, unverified way for a
 * phrase to land in a grammatical slot. `selves` completes "I'm ...", `uncertainty`
 * completes "I keep ...", `agency` completes "So I ...", `conclusion` is a standalone
 * closing line, and `perspective` follows the same shape as `PERSPECTIVE_DETAILS`
 * (readable alone and after "the east side, ...").
 *
 * `leaving-and-staying` is written to the same subject the general banks already
 * carry, so it reads as a deliberate choice rather than a leftover.
 */
const SUBJECT_MATERIAL: SubjectTable = {
  'leaving-and-staying': {
    adlib: 'the porch light again',
    selves: ['still here at closing', 'no good at leaving', 'halfway out the door'],
    banks: {
      perspective: ['same kitchen, different year', 'nobody locked the door', 'the sign still flickers'],
      uncertainty: ['second-guessing the goodbye', 'rehearsing the leaving speech'],
      agency: ['say it first', 'take the long way'],
      conclusion: ['We never did decide', 'This is not the end of it'],
    },
  },
  'city-and-work': {
    adlib: 'the late shift',
    selves: ['new in this city', 'thirty and tired', 'two jobs in'],
    banks: {
      perspective: ['the kitchen light on at five', 'the rent due on the first', 'the platform filling up'],
      uncertainty: ['checking the group chat', 'counting what is left', 'rewriting the resume'],
      agency: ['take the early shift', 'learn the hard way', 'pay the price'],
      conclusion: ['Same city, different job', 'Nobody said it would be fair'],
    },
  },
  'family-and-distance': {
    adlib: 'the kitchen table',
    selves: ['the one who moved away', 'home for the weekend', 'on the phone every Sunday'],
    banks: {
      perspective: ['the kitchen radio low', 'a chair nobody sits in', 'plates chipped at the edge'],
      uncertainty: ['forgetting the birthdays', 'meaning to call back', 'waiting for the right time'],
      agency: ['take the train home', 'ask for more', 'keep my word'],
      conclusion: ['Somebody left the light on', 'I still know the way back'],
    },
  },
  'celebration-and-hustle': {
    adlib: 'the last song of the night',
    selves: ['still on the floor', 'the last one dancing', 'louder than the room'],
    banks: {
      perspective: ['the speakers still ringing', 'the same three songs again', 'a floor that will not quit'],
      uncertainty: ['counting the takings', 'betting on tomorrow', 'starting again on Monday'],
      agency: ['turn it up', 'call it ours', 'count it twice'],
      conclusion: ['And the night is not finished', 'We are still here anyway'],
    },
  },
  'memory-and-loss': {
    adlib: 'a photograph, faded',
    selves: ['still counting the years', 'the one who kept it', 'here in the quiet'],
    banks: {
      perspective: ['letters stacked by the door', 'a coat that still smells of smoke', 'the garden gone quiet'],
      uncertainty: ['reading the messages back', 'keeping the old number', 'putting it off for years'],
      agency: ['say it out loud', 'let it go', 'stop waiting'],
      conclusion: ['Maybe that is enough', 'Somewhere the light is still on'],
    },
  },
  'starting-over': {
    adlib: 'a key that no longer fits',
    selves: ['new here and fine with it', 'packed and ready', 'already halfway gone'],
    banks: {
      perspective: ['a suitcase by the door', 'a map folded the wrong way', 'the first morning somewhere else'],
      uncertainty: ['checking the map again', 'learning the new streets', 'rewriting the ending'],
      agency: ['call it off', 'walk out clean', 'take the wheel'],
      conclusion: ['This is not where it ends', 'Tomorrow counts as a start'],
    },
  },
};

/** Subject-aware bank lookup; any stage a subject omits uses the general bank. */
const bank = bankPicker(SUBJECT_MATERIAL);

/**
 * Whole-line primitives for styles that place lines themselves (see `primitives.ts`).
 *
 * Every entry is a complete line, because a writing agent chooses the order: a question
 * has to read as a question wherever it lands, and an answer has to stand alone. They are
 * also written subject-agnostic - the subject is carried by the rest of the song.
 */
const PRIMITIVE_BANKS: Partial<Record<PrimitiveId, string[]>> = {
  question: [
    'Why did you leave this town',
    'Where do you go when you go',
    'Who is gonna save me now',
    'What do I do with the rest',
    'How long do I keep the light on',
    'When did we stop being us',
    'Who is going to tell me the truth',
  ],
  answer: [
    'Because I could not stay',
    'Nobody, and nobody came',
    'I do not know, and that is the truth',
    'Because it was never about me',
    'Because somebody had to',
    'I was already half gone',
  ],
  // A stated position: the promise, the confession, the belief the song then tests.
  claim: [
    'I said I would never call',
    'I told myself I was fine',
    'Everybody says that time heals',
    'I promised I would stay away',
    'I keep saying I am over it',
  ],
  // The line that undercuts the claim above it.
  reversal: [
    'Then I dialled your number anyway',
    'But I still watch the door',
    'So why do I still remember',
    'And I was already halfway back',
    'Except I never really left',
  ],
  // What the image implies, one step short of saying it.
  implication: [
    'Which means somebody stopped waiting',
    'So this is what leaving looks like',
    'That is what the quiet was about',
    'Which means the light was never mine',
    'So that is how it ends',
  ],
  // The wider statement the detail was standing in for.
  universal: [
    'Everyone leaves something behind',
    'Nobody gets to keep the year',
    'We all learn it the same way',
    'Some things end in hindsight',
    'You cannot hold it and leave it',
  ],
  // Ordered escalation: the array *is* the escalation, so the order must not be shuffled.
  ladder: [
    'I lost the keys again',
    'I missed the last train home',
    'I missed the interview',
    'I lost the job in March',
    'I cannot make the rent',
  ],
  // A stated limit, for the countdown style's invisible clock.
  deadline: [
    'Three days until the money runs out',
    'One night before the train leaves',
    'Ten dollars until the weekend',
    'Two hours until they close the doors',
    'One week until the hearing',
  ],
  // Short and stripped, for the break in a groove-return song.
  fragment: [
    'Just the rain',
    'Nothing else',
    'Only silence',
    'Still nothing',
    'No one answers',
  ],
};

export const englishPack: LanguagePack = {
  code: 'en',
  label: 'English',
  nativeLabel: 'English',
  script: 'latin',
  complete: true,
  subjectCoverage: subjectIdsOf(SUBJECT_MATERIAL),
  primitives: PRIMITIVE_BANKS,

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

  // The market's own chart word wins when one is usable, then the subject's ad-lib,
  // then the hook: an intro should say something about this song, not just repeat it.
  introLine: (ctx) => `(${ctx.topicWord ?? subjectAdlib(SUBJECT_MATERIAL, ctx) ?? ctx.hook})`,
  reframe: boundedReframe('latin'),

  metaphors: (family) => metaphorsFor(family),

  render: {
    perspective: (count, ctx, used) => {
      const time = fromBank(ctx.rng, TIMES, used);
      // The preposition is bound to the bank the place came from, so "on a
      // rented room" is structurally impossible.
      const useOn = ctx.rng() < 0.5;
      const place = fromBank(ctx.rng, useOn ? ON_PLACES : IN_PLACES, used);
      const self = fromBank(ctx.rng, subjectSelves(SUBJECT_MATERIAL, ctx) ?? SELVES, used);
      const detail = fromBank(ctx.rng, bank(ctx, 'perspective', PERSPECTIVE_DETAILS), used);
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
          `I keep ${fromBank(ctx.rng, bank(ctx, 'uncertainty', GERUNDS), used)}`,
        ],
        count,
      );
    },

    agency: (count, ctx, used) => {
      return takeLines(
        [
          `So I ${fromBank(ctx.rng, bank(ctx, 'agency', AGENCY_ACTIONS), used)}`,
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
        [
          fromBank(ctx.rng, bank(ctx, 'conclusion', UNRESOLVED_LINES), used),
          `Somewhere it's still ${fromBank(ctx.rng, TIMES, used)}`,
        ],
        count,
      );
    },
  },
};

export type { LyricContext };