/**
 * Typed phrase banks for arc-driven songwriting.
 *
 * Every bank is written to be grammatical inside the template that consumes it
 * (the templates live in lyrics.ts). Earlier versions of this generator dropped
 * raw chart tokens into slots and produced lines like "It's last and I'm hustle",
 * so the rule here is: a bank entry must read correctly in its one template, and
 * nothing from the outside world is ever interpolated into a grammatical slot -
 * external words are only used as standalone ad-libs.
 */

/** Where/when the speaker stands (perspective). */
export const TIMES = [
  'midnight',
  'the morning after',
  'golden hour',
  'closing time',
  'another Sunday',
  'four in the morning',
  'the end of the season',
];

/**
 * Places, split by the preposition they take, so the template "It's ${time} ${on|in}
 * ${place}" can never produce "on a rented room".
 */
export const ON_PLACES = [
  'this street',
  'the east side',
  'a dead-end road',
  'the old ring road',
  'the last bus home',
];

export const IN_PLACES = ['a rented room', 'the corner shop', 'a borrowed car', 'the back of the venue'];

/** Self-descriptions: "I'm ${SELF}". */
export const SELVES = [
  'nineteen and certain',
  'thirty and tired',
  'the last one awake',
  'still here at closing',
  'halfway out the door',
  'new in this city',
  'no good at leaving',
];

export const PERSPECTIVE_DETAILS = [
  'same kitchen, different year',
  'nothing here has moved',
  'the sign still flickers',
  'nobody locked the door',
  'the radio plays the same three songs',
];

/** Completes "I don't know if I ${...}". */
export const UNCERTAIN_ACTIONS = [
  'can hold this',
  'read it right',
  'want the same',
  'should have called',
  'belong here',
  'have another try',
];

/** Completes "Maybe ${subject} ${...}". */
export const UNCERTAIN_CLAUSES = [
  'got it wrong',
  'were always leaving',
  'never had a choice',
  'were only passing through',
  'said it too late',
];

export const UNCERTAIN_ADJECTIVES = ['certain', 'finished', 'mine', 'simple', 'settled'];

/** Completes "I keep ${...}". */
export const GERUNDS = [
  'checking the door',
  'rehearsing the words',
  'waiting for a sign',
  'counting the hours',
  'rewriting the ending',
];

/**
 * Subjects for the hook. Restricted to plural / first-person so the base-form
 * verb phrases in AGENCY_ACTIONS always agree with them - "Late-night drive say
 * it first" was the bug that motivated this rule. Market flavour still reaches the
 * song through the style prompt, the metaphor, the title and the intro ad-lib.
 */
export const HOOK_SUBJECTS = ['We', 'You and I', 'The two of us', 'All of us', 'You and me', 'All of us here'];

/**
 * Hook verb phrases: plural- and first-person-safe, and written to read as a
 * mantra rather than an instruction (the agency stage has its own bank).
 */
export const HOOK_VERBS = [
  'keep the light on',
  'say it first',
  'hold the line',
  'take the long way',
  'count it twice',
  'turn it up',
  'wait it out',
  'leave the porch light on',
  'let the record show',
  'call it ours',
];

/** Completes "So I ${...}": the turn to agency. */
export const AGENCY_ACTIONS = [
  'take the wheel',
  'call it off',
  'let it go',
  'say it first',
  'stop waiting',
  'pay the price',
  'walk out clean',
];

export const AGENCY_PLANS = ['stop pretending', 'learn the hard way', 'do it anyway', 'ask for more'];

export const AGENCY_CHOICES = ['choose the quiet', 'go first', 'keep my word', 'take the long road'];

/** Completes "I'm done ${...}". */
export const DONE_GERUNDS = ['waiting on the weather', 'asking permission', 'sleeping on it'];

/** Opposing verb phrases: "I ${a}, but I ${b}". */
export const CONTRADICTION_PAIRS: Array<[string, string]> = [
  ['let it go', 'hold the line'],
  ['run it back', 'walk away'],
  ['keep it quiet', 'say it loud'],
  ['hold on tight', 'let it slide'],
  ['break the fall', 'fall apart'],
  ['take the blame', 'put it down'],
  ['move on', 'stay the night'],
  ['call it off', 'show up anyway'],
];

/** Opposing adjectives: "I'm ${a}, still ${b}". */
export const CONTRAST_ADJECTIVES: Array<[string, string]> = [
  ['weightless', 'grounded'],
  ['wide awake', 'dreaming'],
  ['steady', 'shaking'],
  ['honest', 'hiding'],
  ['certain', 'lost'],
  ['brave', 'scared'],
];

/**
 * Subjects for the scale expansion, split by grammatical number so the template
 * "${subject} is/are ${...} tonight" always agrees ("all of us out here are quiet",
 * "the whole city awake is quiet").
 */
export const WIDE_SINGULAR = ['this whole town', 'the whole city awake', 'every kitchen light', 'everyone still driving home'];

export const WIDE_PLURAL = ['all of us out here', 'everyone on the line', 'the ones still driving home'];

/** Completes "${wide subject} is ${...} tonight" (scale expansion). */
export const WIDE_ADJECTIVES = ['awake', 'quiet', 'honest', 'wide open', 'still going'];

/** Completes "We're all ${...}". */
export const WIDE_GERUNDS = [
  'waiting on the same train',
  'learning the same song',
  'counting the same hours',
  'holding the same door',
];

/** Unresolved closings - deliberately open. */
export const UNRESOLVED_LINES = [
  "And I still don't know",
  'We never did decide',
  "Maybe that's enough",
  "This isn't over yet",
  'Nobody said the end',
];

/** Qualifiers used to reframe the hook at the end rather than end it. */
export const REFRAME_QUALIFIERS = ['or maybe we don\'t', 'for now', 'or something close to it', 'just for tonight'];