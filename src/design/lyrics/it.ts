/**
 * Italian pack.
 *
 * Grammar decisions:
 *
 *  - predicative adjectives are avoided where they would need gender agreement
 *    ("sono stanco/stancha") by using invariable adverbial phrases, and the closing
 *    "Ho finito di..." construction instead of "Sono stanco di...";
 *  - places take "in", which is correct with all of them, so no articulated
 *    preposition table is needed at runtime;
 *  - the scale expansion uses whole already-agreeing clauses, since composing
 *    adjective + noun at runtime cannot respect gender;
 *  - time expressions carry their own copula so "È mezzanotte" and "Sono le quattro"
 *    are both correct.
 */
import { fromBank, pairFromBank, sentenceCase, takeLines, type LanguagePack } from './types.js';

/** Time expressions carry their own copula ("È mezzanotte" / "Sono le quattro"). */
const TIMES: Array<{ lead: string; text: string }> = [
  { lead: 'È', text: 'mezzanotte' },
  { lead: 'È', text: "l'ora d'oro" },
  { lead: 'È', text: 'la fine della stagione' },
  { lead: 'È', text: "un'altra domenica" },
  { lead: 'Sono', text: 'le quattro del mattino' },
  { lead: 'È', text: "l'ora di chiudere" },
];

/** "in" is correct with every one of these, so no preposition table is needed. */
const PLACES = ['questa strada', 'il lato est', 'una strada senza uscita', "l'ultimo autobus", 'una stanza in affitto', 'il fondo della sala'];

/** Invariable self-descriptions: no gender agreement required. */
const SELVES = ['ancora qui', 'di passaggio', 'tra due addii', 'nello stesso posto', 'dal lato del silenzio'];

const DETAILS = [
  'la stessa cucina, un altro anno',
  'qui non si è mosso niente',
  "l'insegna lampeggia ancora",
  'nessuno ha chiuso la porta',
  'la radio mette sempre le stesse canzoni',
];

/** Completes "Non so se posso ...". */
const UNCERTAIN_INFINITIVES = ['reggere questo', 'leggerlo bene', 'volere la stessa cosa', 'restare qui', 'ricominciare'];

/** Completes "Forse ..." (first-person plural, so no agreement). */
const UNCERTAIN_CLAUSES = ['ci siamo sbagliati', 'stavamo già andando', 'non abbiamo mai scelto', 'passavamo solo di qui', "l'abbiamo detto tardi"];

/** Completes "Qui niente è ...". */
const UNCERTAIN_ADJECTIVES = ['sicuro', 'semplice', 'mio', 'definitivo', 'chiaro'];

/** Completes "Continuo a ...". */
const CONTINUE_INFINITIVES = ['guardare la porta', 'ripetere le parole', 'aspettare un segno', 'contare le ore', 'riscrivere il finale'];

/** Completes "Così ...". */
const AGENCY_ACTIONS = ['prendo il volante', 'lo lascio andare', 'lo dico per primo', 'pago il prezzo', 'me ne vado pulito'];

/** Completes "Voglio ...". */
const PLANS = ['smettere di fingere', 'imparare a mie spese', 'farlo lo stesso', 'chiedere di più'];

/** Completes "Stavolta ...". */
const CHOICES = ['scelgo il silenzio', 'passo avanti', 'mantengo la parola', 'prendo la strada lunga'];

/** Completes "Ho finito di ..." (avoids the gendered "sono stanco di"). */
const DONE_INFINITIVES = ['aspettare il tempo', 'chiedere permesso', 'rimandare'];

/** First-person singular both sides, so "Io X, ma Y" always agrees. */
const CONTRADICTION_PAIRS: Array<[string, string]> = [
  ['lo lascio andare', 'lo tengo stretto'],
  ['me ne vado', 'resto'],
  ['sto zitto', 'lo dico forte'],
  ['stringo i denti', 'lo lascio scivolare'],
  ['ammortizzo il colpo', 'cado a pezzi'],
  ['vado avanti', 'resto stanotte'],
  ['annullo tutto', 'mi presento lo stesso'],
];

/** Invariable qualities (adverbial) paired with a first-person verb. */
const CONTRAST_PAIRS: Array<[string, string]> = [
  ['in pace', 'tremo'],
  ['in piedi', 'cado a pezzi'],
  ['senza paura', 'dubito'],
  ['al limite', 'sorrido'],
  ['insonne', 'sogno'],
];

/** Whole agreeing clauses - see the header note on gender agreement. */
const WIDE_CLAUSES = [
  'tutta la città resta sveglia',
  'ogni finestra accesa veglia ancora',
  'quelli che tornano a casa contano le stesse ore',
  'il quartiere intero trattiene il fiato',
  'siamo tutti nella stessa notte',
];

const WIDE_INFINITIVES = ['ad aspettare lo stesso treno', 'a imparare la stessa canzone', 'a contare le stesse ore', 'a tenere la stessa porta'];

const UNRESOLVED = [
  'E ancora non lo so',
  'Non abbiamo mai deciso',
  'Forse basta così',
  'Non è finita',
  'Nessuno ha detto la fine',
];

const QUALIFIERS = ['o forse no', 'per ora', 'o qualcosa del genere', 'solo per stanotte'];

/** Subject-free 1st-person-plural verbs: the lead already supplies "noi". */
const HOOK_VERBS = [
  'teniamo la luce accesa',
  'lo diciamo per primi',
  'reggiamo fino al mattino',
  'prendiamo la strada lunga',
  'lo contiamo due volte',
  'alziamo il volume',
  'lasciamo la porta aperta',
  'lo chiamiamo nostro',
];

/** Short leads on purpose: the hook recurs in every chorus, so it drives meter score. */
const HOOK_LEADS = ['Noi', 'Io e te', 'Noi due', 'Tutti qui'];

/** Metaphors as Italian objects, not translations of the English bank. */
const METAPHORS: Record<string, string[]> = {
  roots: ['un cancello che cigola', 'una staccionata da sistemare', 'un cane che aspetta fuori', 'la strada sterrata dopo la pioggia'],
  urban: ['un portone illuminato', 'una porta lasciata aperta', 'un telefono che non suona', 'il sesto piano della palazzina B'],
  club: ['uno strobo che tiene il tempo', 'un basso che non si ferma', 'la luce del soffitto che gira'],
  band: ['una chitarra scordata', 'un amplificatore che soffia', 'il fondo della sala'],
  afro: ['un tessuto piegato ad anello', 'una moto che passa troppo veloce', 'la polvere al tramonto'],
  eastasia: ['un ombrello dimenticato sul treno', 'una moneta nella macchinetta', 'una macchinetta che ronza'],
  latin: ['una sedia di plastica sul marciapiede', 'una radio sul balcone', 'un frigo che gocciola'],
  southasia: ['un tè dolce che si raffredda', 'sandali alla porta', 'un ventilatore che gira'],
  quiet: ['un orologio che fa troppo rumore', 'una sedia vuota di fronte', 'il vapore sul vetro'],
  europe: ['un biglietto del treno piegato', 'un bicchiere ancora pieno', 'una lettera mai spedita'],
  general: ['una chiave che non serve più', 'un cappotto troppo leggero', 'la luce del corridoio', 'un nome scritto a matita'],
};

export const italianPack: LanguagePack = {
  code: 'it',
  label: 'Italian',
  nativeLabel: 'Italiano',
  script: 'latin',
  complete: true,

  buildHook: (rng) => `${fromBank(rng, HOOK_LEADS)} ${fromBank(rng, HOOK_VERBS)}`,
  buildScale: (rng) => ({ subject: fromBank(rng, WIDE_CLAUSES), verb: '' }),

  pickContradiction: (rng) => pairFromBank(rng, CONTRADICTION_PAIRS, new Set()),
  pickContrast: (rng) => pairFromBank(rng, CONTRAST_PAIRS, new Set()),
  pickQualifier: (rng) => fromBank(rng, QUALIFIERS),

  // Chart terms are English/Latin tokens, so the intro uses the hook instead.
  introLine: (ctx) => `(${ctx.hook})`,
  reframe: (hook, qualifier) => `${hook}, ${qualifier}`,

  metaphors: (family) => [...(METAPHORS[family] ?? []), ...METAPHORS.general.slice(0, 2)],

  render: {
    perspective: (count, ctx, used) => {
      const time = TIMES[Math.floor(ctx.rng() * TIMES.length)] ?? TIMES[0];
      const place = fromBank(ctx.rng, PLACES, used);
      // No "place, detail" concatenation: joining two longer phrases pushed lines past
      // the meter band, which the validator caught as a drop in meter fit.
      return takeLines(
        [
          `${time.lead} ${time.text} in ${place}`,
          `Sono ${fromBank(ctx.rng, SELVES, used)}`,
          sentenceCase(fromBank(ctx.rng, DETAILS, used)),
        ],
        count,
      );
    },

    uncertainty: (count, ctx, used) =>
      takeLines(
        [
          `Non so se posso ${fromBank(ctx.rng, UNCERTAIN_INFINITIVES, used)}`,
          `Forse ${fromBank(ctx.rng, UNCERTAIN_CLAUSES, used)}`,
          `Qui niente è ${fromBank(ctx.rng, UNCERTAIN_ADJECTIVES, used)}`,
          `Continuo a ${fromBank(ctx.rng, CONTINUE_INFINITIVES, used)}`,
        ],
        count,
      ),

    agency: (count, ctx, used) =>
      takeLines(
        [
          `Così ${fromBank(ctx.rng, AGENCY_ACTIONS, used)}`,
          `Voglio ${fromBank(ctx.rng, PLANS, used)}`,
          `Stavolta ${fromBank(ctx.rng, CHOICES, used)}`,
          `Ho finito di ${fromBank(ctx.rng, DONE_INFINITIVES, used)}`,
        ],
        count,
      ),

    contradiction: (count, ctx) => {
      const [a, b] = ctx.contradiction;
      const [x, y] = ctx.contrast;
      return takeLines(
        [
          ctx.hook,
          `Io ${a}, ma ${b}`,
          `Sono ${x}, ma ${y}`,
          // Reuses the same first-person forms, so nothing needs an infinitive.
          `Io ${a}, eppure ${b}`,
        ],
        count,
      );
    },

    metaphor: (count, ctx) =>
      takeLines(
        [
          `C'è ${ctx.metaphor}`,
          'Ed è ancora la più alta',
          // Deliberately does not interpolate the metaphor: the concatenation was long
          // and restating the image reads worse.
          'E nessuno lo muove',
        ],
        count,
      ),

    scale: (count, ctx, used) =>
      takeLines(
        [
          'Non sono solo io',
          sentenceCase(ctx.wideSubject),
          `Siamo tutti ${fromBank(ctx.rng, WIDE_INFINITIVES, used)}`,
        ],
        count,
      ),

    conclusion: (count, ctx, used) => {
      if (ctx.conclusion === 'reframed') {
        return Array.from({ length: Math.min(count, 2) }, () =>
          `(${italianPack.reframe(ctx.hook, ctx.qualifier)})`,
        );
      }
      const time = TIMES[Math.floor(ctx.rng() * TIMES.length)] ?? TIMES[0];
      return takeLines(
        [
          fromBank(ctx.rng, UNRESOLVED, used),
          `Da qualche parte ${time.lead.toLowerCase()} ancora ${time.text}`,
        ],
        count,
      );
    },
  },
};

