/**
 * German pack.
 *
 * Grammar decisions:
 *
 *  - interpolation is nominative-only ("Da ist ..."), because German article forms
 *    change with case and a runtime-composed noun phrase would produce "Es gibt ein
 *    Zaun" instead of "einen Zaun";
 *  - the uncertainty stage supplies whole *subordinate* clauses ("..., ob ich das
 *    halten kann") so the verb-final rule is satisfied by construction rather than
 *    by word order luck;
 *  - the agency stage uses inversion after a fronted adverb ("Also nehme ich das
 *    Steuer"), which is where German word order stops resembling English;
 *  - separable verbs are avoided in banks, since their prefix has to migrate to
 *    the clause end and cannot be assembled from template parts safely;
 *  - predicate adjectives need no agreement ("Ich bin ruhig"), unlike attributive
 *    ones, so self-descriptions stay short and safe.
 */
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
  type SubjectTable,
} from './types.js';
import type { PrimitiveId } from './primitives.js';

/**
 * Whole-line primitives for styles that place lines themselves (see `primitives.ts`).
 *
 * Complete lines: an agent chooses the order, so nothing here may depend on a template around it.
 * Every entry is nominative-safe and free of separable verbs, like the rest of this pack.
 */
const PRIMITIVE_BANKS: Partial<Record<PrimitiveId, string[]>> = {
  question: [
    'Warum bist du gegangen',
    'Wohin gehst du, wenn du gehst',
    'Wer rettet mich jetzt',
    'Was mache ich mit dem Rest',
    'Wie lange lasse ich das Licht an',
    'Wann waren wir nicht mehr wir',
  ],
  answer: [
    'Weil ich nicht bleiben konnte',
    'Niemand, und niemand kam',
    'Ich weiß es nicht, und das ist wahr',
    'Es ging nie um mich',
    'Weil es jemand tun musste',
    'Ich war schon halb weg',
  ],
  claim: [
    'Ich sagte, ich rufe nie an',
    'Ich redete mir ein, es geht',
    'Man sagt, die Zeit heilt alles',
    'Ich hab versprochen, fernzubleiben',
    'Ich sage mir, es ist vorbei',
  ],
  reversal: [
    'Und dann habe ich angerufen',
    'Aber ich schaue noch zur Tür',
    'Warum erinnere ich mich dann',
    'Ich war schon halb zurück',
    'Eigentlich bin ich nie gegangen',
  ],
  implication: [
    'Das heißt, jemand hat aufgehört',
    'So sieht Weggehen also aus',
    'Darum ging es bei der Stille',
    'Das Licht war nicht für mich',
    'So endet es also',
  ],
  universal: [
    'Jeder lässt etwas zurück',
    'Niemand behält das Jahr',
    'Wir lernen es alle gleich',
    'Manches endet erst später',
    'Man kann nicht halten und gehen',
  ],
  ladder: [
    'Ich habe die Schlüssel verloren',
    'Ich habe den Zug verpasst',
    'Ich habe das Gespräch verpasst',
    'Im März habe ich den Job verloren',
    'Ich kann die Miete nicht zahlen',
  ],
  deadline: [
    'Drei Tage bis das Geld weg ist',
    'Eine Nacht bis der Zug fährt',
    'Zehn Euro bis zum Wochenende',
    'Zwei Stunden bis sie schließen',
    'Eine Woche bis zur Verhandlung',
  ],
  fragment: ['Nur der Regen', 'Nichts sonst', 'Nur die Stille', 'Immer noch nichts', 'Niemand antwortet'],
};

/**
 * Subject material.
 *
 * `selves` completes "Ich bin ...", so every entry is a predicate phrase with no
 * agreement requirement; the closing lines keep the shape of `UNRESOLVED` - short
 * complete sentences with the verb in second position. Subjects that omit a stage
 * fall back to the general bank, so coverage can be deepened one subject at a time.
 */
const SUBJECT_MATERIAL: SubjectTable = {
  'starting-over': {
    adlib: 'ein Schlüssel, der nicht mehr passt',
    selves: ['schon halb weg', 'neu hier', 'unterwegs'],
    banks: { conclusion: ['Das ist nicht das Ende', 'Morgen zählt als Anfang'] },
  },
  'city-and-work': {
    adlib: 'die Spätschicht',
    selves: ['noch auf Nachtschicht', 'zwischen zwei Schichten', 'neu in dieser Stadt'],
    banks: { conclusion: ['Die Miete kommt am Ersten', 'Niemand hat das je versprochen'] },
  },
  'memory-and-loss': {
    adlib: 'ein verblichenes Foto',
    selves: ['noch am Zählen', 'auf der stillen Seite', 'noch hier'],
    banks: { conclusion: ['Nichts davon ist weg', 'Jemand hat das Licht gelassen'] },
  },
};

/** Subject-aware bank lookup; any stage a subject omits uses the general bank. */
const bank = bankPicker(SUBJECT_MATERIAL);

/** Bare time nouns: "Es ist Mitternacht" reads correctly without an article. */
const TIMES = ['Mitternacht', 'Feierabend', 'Sonntagnacht', 'vier Uhr morgens', 'Saisonende', 'die letzte Runde'];

/** Dative forms are baked in, so "auf dieser Straße" cannot become "auf diese". */
const ON_PLACES = ['dieser Straße', 'der Ostseite', 'einer Sackgasse', 'dem letzten Bus'];
const IN_PLACES = ['einem gemieteten Zimmer', 'dem Eckladen', 'einem geliehenen Auto', 'dem hinteren Teil des Saals'];

/** Predicate adjectives with no agreement requirement. */
const SELVES = ['noch hier', 'neu in dieser Stadt', 'zwischen zwei Abschieden', 'an derselben Stelle', 'auf der stillen Seite'];

const DETAILS = [
  'dieselbe Küche, ein anderes Jahr',
  'hier hat sich nichts bewegt',
  'das Schild flackert noch',
  'niemand hat die Tür abgeschlossen',
  'das Radio spielt immer dieselben Lieder',
];

/** Full subordinate clauses, so the finite verb lands at the end. */
const UNCERTAIN_CLAUSES = [
  'ob ich das halten kann',
  'ob ich es richtig lese',
  'ob ich dasselbe will',
  'ob ich hier bleiben kann',
  'ob ich neu anfangen kann',
];

const UNCERTAIN_ADJECTIVES = ['sicher', 'einfach', 'fertig', 'meins', 'geklärt'];

const CONTINUE_ACTIONS = [
  'Ich zähle weiter die Stunden',
  'Ich prüfe weiter die Tür',
  'Ich übe weiter die Worte',
  'Ich warte weiter auf ein Zeichen',
  'Ich schreibe weiter das Ende um',
];

/** Inversion after a fronted adverb: "Also nehme ich ...". */
const AGENCY_ACTIONS = [
  'Also nehme ich das Steuer',
  'Also sage ich es zuerst',
  'Also lasse ich es los',
  'Also zahle ich den Preis',
  'Also gehe ich sauber raus',
];

const AGENCY_PLANS = [
  'Ich werde nicht mehr so tun',
  'Ich werde es trotzdem tun',
  'Ich werde mehr verlangen',
  'Ich werde es auf die harte Tour lernen',
];

const AGENCY_CHOICES = [
  'Diesmal wähle ich die Stille',
  'Diesmal gehe ich zuerst',
  'Diesmal halte ich mein Wort',
  'Diesmal nehme ich den langen Weg',
];

const DONE_LINES = ['Ich habe es satt, zu warten', 'Ich habe es satt, zu fragen', 'Ich habe es satt, es aufzuschieben'];

/** First-person singular present on both sides, so agreement always holds. */
const CONTRADICTION_PAIRS: Array<[string, string]> = [
  ['lasse los', 'halte fest'],
  ['gehe weg', 'bleibe noch'],
  ['schweige', 'sage es laut'],
  ['halte fest', 'lasse es gleiten'],
  ['fange dich auf', 'falle auseinander'],
  ['gehe voran', 'bleibe diese Nacht'],
  ['sage alles ab', 'komme trotzdem'],
];

const CONTRAST_PAIRS: Array<[string, string]> = [
  ['ruhig', 'zittere'],
  ['wach', 'träume noch'],
  ['ehrlich', 'verstecke mich'],
  ['sicher', 'habe Angst'],
  ['mutig', 'fürchte mich'],
];

/**
 * Whole already-agreeing clauses for the scale expansion, including the
 * "wir sind alle dabei, ... zu ..." construction (German has no gerund).
 * Trimmed to ~7-10 syllables: the validator flagged longer drafts as unsingable.
 */
const WIDE_CLAUSES = [
  'die ganze Stadt bleibt wach',
  'jedes erleuchtete Fenster wacht noch',
  'alle, die heimfahren, zählen mit',
  'das ganze Viertel hält den Atem an',
  'wir stehen alle in derselben Nacht',
];

const WIDE_INFINITIVES = [
  'auf denselben Zug zu warten',
  'dasselbe Lied zu lernen',
  'dieselben Stunden zu zählen',
  'dieselbe Tür zu halten',
];

const UNRESOLVED = [
  'Und ich weiß es immer noch nicht',
  'Wir haben uns nie entschieden',
  'Vielleicht ist das genug',
  'Das ist noch nicht vorbei',
  'Niemand hat das Ende gesagt',
];

const QUALIFIERS = ['oder vielleicht auch nicht', 'fürs Erste', 'oder so ähnlich', 'nur für heute Nacht'];

/** Subject-free verb phrases: the lead supplies "Wir". */
const HOOK_VERBS = [
  'halten die Stellung',
  'sagen es zuerst',
  'nehmen den langen Weg',
  'zählen es zweimal',
  'drehen lauter',
  'lassen das Licht brennen',
  'nennen es unser',
  'bleiben bis zum Morgen',
];

const HOOK_LEADS = ['Wir', 'Du und ich, wir', 'Wir zwei, wir', 'Alle hier, wir'];

/**
 * Nominative noun phrases only, so "Da ist ..." is always correct.
 * Any relative clause is written with the matching nominative relative pronoun.
 */
const METAPHORS: Record<string, string[]> = {
  roots: ['ein Tor, das quietscht', 'ein Zaun, der repariert werden muss', 'ein Hund, der draußen wartet', 'die Landstraße nach dem Regen'],
  urban: ['ein beleuchtetes Treppenhaus', 'eine offen gelassene Tür', 'ein Telefon, das nicht klingelt', 'der sechste Stock im Block B'],
  club: ['ein Stroboskop, das den Takt hält', 'ein Bass, der nicht aufhört', 'das Licht an der Decke, das sich dreht'],
  band: ['eine verstimmte Gitarre', 'ein Verstärker, der rauscht', 'der hintere Teil des Saals'],
  afro: ['ein gefalteter Stoff als Ring', 'ein Motorrad, das zu schnell vorbeifährt', 'der Staub bei Sonnenuntergang'],
  eastasia: ['ein Regenschirm, der im Zug bleibt', 'eine Münze im Automaten', 'ein Automat, der vor sich hin summt'],
  latin: ['ein Plastikstuhl auf dem Bürgersteig', 'ein Radio auf dem Balkon', 'eine Kühlbox, die undicht ist'],
  southasia: ['ein süßer Tee, der kalt wird', 'Sandalen an der Tür', 'ein Ventilator, der sich dreht'],
  quiet: ['eine Uhr, die zu laut tickt', 'ein leerer Stuhl gegenüber', 'Beschlag auf dem Fenster'],
  europe: ['eine gefaltete Fahrkarte', 'ein Glas, das noch voll ist', 'ein Brief, der nie abgeschickt wurde'],
  general: ['ein Schlüssel, der nicht mehr passt', 'ein zu leichter Mantel', 'das Licht im Flur', 'ein Name mit Bleistift geschrieben'],
};

export const germanPack: LanguagePack = {
  code: 'de',
  label: 'German',
  nativeLabel: 'Deutsch',
  script: 'latin',
  complete: true,
  subjectCoverage: subjectIdsOf(SUBJECT_MATERIAL),
  primitives: PRIMITIVE_BANKS,

  buildHook: (rng) => `${fromBank(rng, HOOK_LEADS)} ${fromBank(rng, HOOK_VERBS)}`,
  buildScale: (rng) => ({ subject: fromBank(rng, WIDE_CLAUSES), verb: '' }),

  pickContradiction: (rng) => pairFromBank(rng, CONTRADICTION_PAIRS, new Set()),
  pickContrast: (rng) => pairFromBank(rng, CONTRAST_PAIRS, new Set()),
  pickQualifier: (rng) => fromBank(rng, QUALIFIERS),

  // Chart terms are foreign tokens here, so the intro uses the hook instead.
  introLine: (ctx) => `(${subjectAdlib(SUBJECT_MATERIAL, ctx) ?? ctx.hook})`,
  reframe: boundedReframe('latin'),

  metaphors: (family) => [...(METAPHORS[family] ?? []), ...METAPHORS.general.slice(0, 2)],

  render: {
    perspective: (count, ctx, used) => {
      const time = fromBank(ctx.rng, TIMES, used);
      const useOn = ctx.rng() < 0.5;
      const place = fromBank(ctx.rng, useOn ? ON_PLACES : IN_PLACES, used);
      const self = fromBank(ctx.rng, subjectSelves(SUBJECT_MATERIAL, ctx) ?? SELVES, used);
      const detail = fromBank(ctx.rng, DETAILS, used);
      return takeLines(
        [
          `Es ist ${time} ${useOn ? 'auf' : 'in'} ${place}`,
          `Ich bin ${self}`,
          sentenceCase(detail),
          `${sentenceCase(place)}, ${detail}`,
        ],
        count,
      );
    },

    uncertainty: (count, ctx, used) =>
      takeLines(
        [
          `Ich weiß nicht, ${fromBank(ctx.rng, UNCERTAIN_CLAUSES, used)}`,
          // Verb-second after a fronted adverb: "Vielleicht haben wir ...".
          'Vielleicht haben wir uns getäuscht',
          `Nichts hier ist ${fromBank(ctx.rng, UNCERTAIN_ADJECTIVES, used)}`,
          fromBank(ctx.rng, CONTINUE_ACTIONS, used),
        ],
        count,
      ),

    agency: (count, ctx, used) =>
      takeLines(
        [
          fromBank(ctx.rng, AGENCY_ACTIONS, used),
          fromBank(ctx.rng, AGENCY_PLANS, used),
          fromBank(ctx.rng, AGENCY_CHOICES, used),
          fromBank(ctx.rng, DONE_LINES, used),
        ],
        count,
      ),

    contradiction: (count, ctx) => {
      const [a, b] = ctx.contradiction;
      const [x, y] = ctx.contrast;
      return takeLines(
        [
          ctx.hook,
          `Ich ${a}, aber ich ${b}`,
          `Ich bin ${x}, und ich ${y}`,
          // Was "..., und trotzdem ${b}": after a fronted "trotzdem" German needs
          // the subject, and ${b} already carries the verb - so that rendered as
          // "und trotzdem komme trotzdem". Repeating the subject is correct.
          `Ich ${a}, und ich ${b}`,
        ],
        count,
      );
    },

    metaphor: (count, ctx) =>
      takeLines(
        [
          `Da ist ${ctx.metaphor}`,
          'Und es ist noch das Lauteste hier',
          // No interpolation: any noun phrase here would need the accusative.
          'Und nichts davon geht weg',
        ],
        count,
      ),

    scale: (count, ctx, used) =>
      takeLines(
        [
          // Split deliberately: "Es geht nicht nur um mich, <clause>" ran to ~15
          // syllables against a ~10-syllable budget at 126 BPM.
          'Es geht nicht nur um mich',
          sentenceCase(ctx.wideSubject),
          `Wir sind alle dabei, ${fromBank(ctx.rng, WIDE_INFINITIVES, used)}`,
        ],
        count,
      ),

    conclusion: (count, ctx, used) => {
      if (ctx.conclusion === 'reframed') {
        return Array.from({ length: Math.min(count, 2) }, () =>
          `(${germanPack.reframe(ctx.hook, ctx.qualifier)})`,
        );
      }
      return takeLines(
        [
          fromBank(ctx.rng, bank(ctx, 'conclusion', UNRESOLVED), used),
          `Irgendwo ist es noch ${fromBank(ctx.rng, TIMES, used)}`,
        ],
        count,
      );
    },
  },
};