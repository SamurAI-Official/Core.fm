/**
 * Spanish pack.
 *
 * Grammar decisions:
 *
 *  - predicative adjectives are avoided where they would need gender agreement
 *    ("estoy cansado/cansada") by using invariable adverbial phrases for
 *    self-description;
 *  - places take a single preposition ("en"), which is correct for all of them,
 *    rather than splitting banks by preposition as French requires;
 *  - the scale expansion uses whole already-agreeing clauses, since composing
 *    adjective + noun at runtime cannot respect gender;
 *  - time expressions carry their own lead so "Es medianoche" and "Son las cuatro"
 *    are both correct.
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
 * Complete lines: an agent chooses the order, so nothing here may rely on a template around it,
 * and self-descriptions stay adverbial so no gender agreement is needed.
 */
const PRIMITIVE_BANKS: Partial<Record<PrimitiveId, string[]>> = {
  question: [
    'Por qué te fuiste de aquí',
    'A dónde vas cuando te vas',
    'Quién me va a salvar ahora',
    'Qué hago con lo que queda',
    'Cuánto tiempo dejo la luz',
    'Cuándo dejamos de ser nosotros',
  ],
  answer: [
    'Porque no podía quedarme',
    'Nadie, y nadie vino',
    'No lo sé, y eso es verdad',
    'Nunca fue por mí',
    'Porque alguien tenía que hacerlo',
    'Ya estaba a medio camino',
  ],
  claim: [
    'Dije que nunca llamaría',
    'Me dije que estaba bien',
    'Dicen que el tiempo cura',
    'Prometí quedarme lejos',
    'Repito que ya pasó',
  ],
  reversal: [
    'Y luego marqué tu número',
    'Pero sigo mirando la puerta',
    'Entonces por qué lo recuerdo',
    'Ya estaba a medio camino',
    'En realidad nunca me fui',
  ],
  implication: [
    'Significa que alguien dejó de esperar',
    'Así se ve marcharse',
    'De eso iba el silencio',
    'Esa luz no era para mí',
    'Así termina esto',
  ],
  universal: [
    'Todos dejamos algo atrás',
    'Nadie se queda con el año',
    'Todos lo aprendemos igual',
    'Algunas cosas acaban después',
    'No se puede tener y dejar',
  ],
  ladder: [
    'Perdí las llaves otra vez',
    'Perdí el último tren',
    'Falté a la entrevista',
    'En marzo perdí el trabajo',
    'No puedo pagar el alquiler',
  ],
  deadline: [
    'Tres días hasta que se acabe el dinero',
    'Una noche antes del tren',
    'Diez euros hasta el fin de semana',
    'Dos horas hasta que cierren',
    'Una semana hasta la vista',
  ],
  fragment: ['Solo la lluvia', 'Nada más', 'Solo silencio', 'Sigue sin haber nada', 'Nadie contesta'],
};

/**
 * Subject material.
 *
 * `selves` completes "Estoy ...", so every entry is invariable (adverbial, not
 * adjectival) and needs no gender agreement, exactly like `SELVES`; the closing
 * lines are complete short sentences. Any stage a subject omits falls back to the
 * general bank, so coverage can be deepened one subject at a time.
 */
const SUBJECT_MATERIAL: SubjectTable = {
  'leaving-and-staying': {
    adlib: 'la luz del portal',
    selves: ['todavía aquí', 'en el mismo sitio', 'entre dos despedidas'],
    banks: { conclusion: ['No decidimos nada', 'Esto no se ha acabado'] },
  },
  'celebration-and-hustle': {
    adlib: 'la última canción',
    selves: ['de paso', 'del lado del silencio', 'todavía aquí'],
    banks: { conclusion: ['La fiesta sigue', 'Mañana cuenta igual'] },
  },
  'family-and-distance': {
    adlib: 'la mesa de la cocina',
    selves: ['entre dos despedidas', 'en el mismo sitio', 'de paso'],
    banks: { conclusion: ['Alguien dejó la luz puesta', 'Sé el camino de vuelta'] },
  },
};

/** Subject-aware bank lookup; any stage a subject omits uses the general bank. */
const bank = bankPicker(SUBJECT_MATERIAL);

/** Time expressions carry their own copula ("Es medianoche" / "Son las cuatro"). */
const TIMES: Array<{ lead: string; text: string }> = [
  { lead: 'Es', text: 'medianoche' },
  { lead: 'Es', text: 'la hora dorada' },
  { lead: 'Es', text: 'el final de la temporada' },
  { lead: 'Es', text: 'otro domingo' },
  { lead: 'Son', text: 'las cuatro de la mañana' },
  { lead: 'Es', text: 'la hora de cerrar' },
];

/** Kept short: these are concatenated with a time phrase, so a long place overflows. */
const PLACES = ['esta calle', 'el lado este', 'la carretera vieja', 'el último autobús', 'un cuarto prestado'];

/** Invariable self-descriptions: no gender agreement required. */
const SELVES = ['todavía aquí', 'de paso', 'entre dos despedidas', 'en el mismo sitio', 'del lado del silencio'];

const DETAILS = [
  'la misma cocina, otro año',
  'aquí no se movió nada',
  'el cartel sigue ahí',
  'nadie cerró la puerta',
  'la radio pone lo mismo',
];

/** Completes "No sé si puedo ...". */
const UNCERTAIN_INFINITIVES = ['aguantar esto', 'leerlo bien', 'querer lo mismo', 'quedarme aquí', 'empezar de nuevo'];

/** Completes "Quizá ..." (all are first-person plural preterite, so no agreement). */
const UNCERTAIN_CLAUSES = ['nos equivocamos', 'ya nos íbamos', 'nunca tuvimos elección', 'solo pasábamos por aquí', 'lo dijimos tarde'];

/** Completes "Aquí nada es ...". */
const UNCERTAIN_ADJECTIVES = ['seguro', 'simple', 'mío', 'definitivo', 'claro'];

/** Completes "Sigo ...". */
const CONTINUE_GERUNDS = ['mirando la puerta', 'repitiendo las palabras', 'esperando una señal', 'contando las horas', 'reescribiendo el final'];

/** Completes "Así que ...". */
const AGENCY_ACTIONS = ['tomo el volante', 'lo dejo ir', 'lo digo primero', 'pago el precio', 'me voy limpio'];

/** Completes "Voy a ...". */
const PLANS = ['dejar de fingir', 'aprender por las malas', 'hacerlo igual', 'pedir más'];

/** Completes "Esta vez ...". */
const CHOICES = ['elijo el silencio', 'voy primero', 'cumplo mi palabra', 'tomo el camino largo'];

/** Completes "Ya me cansé de ...". */
const DONE_INFINITIVES = ['esperar el clima', 'pedir permiso', 'dormirlo'];

/** First-person singular both sides, so "Yo X, pero Y" always agrees. */
const CONTRADICTION_PAIRS: Array<[string, string]> = [
  ['lo dejo ir', 'lo aguanto'],
  ['me voy', 'me quedo'],
  ['me callo', 'lo digo fuerte'],
  ['aprieto los dientes', 'lo suelto'],
  ['aguanto el golpe', 'me derrumbo'],
  ['avanzo', 'me quedo esta noche'],
  ['lo cancelo todo', 'me presento igual'],
];

/** Invariable qualities (adverbial, not adjectival) paired with a first-person verb. */
const CONTRAST_PAIRS: Array<[string, string]> = [
  ['en calma', 'tiemblo'],
  ['de pie', 'me derrumbo'],
  ['sin miedo', 'dudo'],
  ['al límite', 'sonrío'],
  ['en vela', 'sueño'],
];

/** Whole agreeing clauses - see the header note on gender agreement. */
const WIDE_CLAUSES = [
  'toda la ciudad sigue despierta',
  'cada ventana encendida sigue velando',
  'los que vuelven a casa cuentan las mismas horas',
  'el barrio entero aguanta la respiración',
  'estamos todos en la misma noche',
];

const WIDE_GERUNDS = ['esperando el mismo tren', 'aprendiendo la misma canción', 'contando las mismas horas', 'sujetando la misma puerta'];

const UNRESOLVED = [
  'Y todavía no lo sé',
  'Nunca decidimos',
  'Quizá sea suficiente',
  'Esto no se ha acabado',
  'Nadie dijo el final',
];

const QUALIFIERS = ['o quizá no', 'por ahora', 'o algo parecido', 'solo por esta noche'];

/** Subject-free 1st-person-plural verbs: the lead already supplies "nosotros". */
const HOOK_VERBS = [
  'dejamos la luz encendida',
  'lo decimos primero',
  'aguantamos hasta el final',
  'tomamos el camino largo',
  'lo contamos dos veces',
  'subimos el volumen',
  'dejamos la puerta abierta',
  'lo llamamos nuestro',
];

/**
 * Short leads on purpose: the hook recurs in every chorus, so a long lead inflates
 * the whole song's meter score. All of these take a first-person-plural verb.
 */
const HOOK_LEADS = ['Nosotros', 'Tú y yo', 'Los dos', 'Todos aquí'];

/** Metaphors as Spanish objects, not translations of the English bank. */
const METAPHORS: Record<string, string[]> = {
  roots: ['una puerta que chirría', 'una valla por arreglar', 'un perro que espera fuera', 'el camino de tierra tras la lluvia'],
  urban: ['un portal iluminado', 'una puerta que quedó abierta', 'un teléfono que no suena', 'el sexto piso del bloque B'],
  club: ['un estrobo que marca el tiempo', 'un bajo que no para', 'la luz del techo que gira'],
  band: ['una guitarra desafinada', 'un amplificador que sopla', 'el fondo de la sala'],
  afro: ['una tela doblada como anillo', 'una moto que pasa demasiado rápido', 'el polvo al atardecer'],
  eastasia: ['un paraguas olvidado en el tren', 'una moneda en la máquina', 'una máquina que zumba'],
  latin: ['una silla de plástico en la acera', 'una radio en el balcón', 'una nevera que gotea'],
  southasia: ['un té dulce que se enfría', 'sandalias en la puerta', 'un ventilador que gira'],
  quiet: ['un reloj que hace demasiado ruido', 'una silla vacía enfrente', 'el vaho en la ventana'],
  europe: ['un billete de tren doblado', 'un vaso todavía lleno', 'una carta que nunca se envió'],
  general: ['una llave que ya no sirve', 'un abrigo demasiado ligero', 'la luz del pasillo', 'un nombre escrito a lápiz'],
};

export const spanishPack: LanguagePack = {
  code: 'es',
  label: 'Spanish',
  nativeLabel: 'Español',
  script: 'latin',
  complete: true,
  subjectCoverage: subjectIdsOf(SUBJECT_MATERIAL),
  primitives: PRIMITIVE_BANKS,

  buildHook: (rng) => `${fromBank(rng, HOOK_LEADS)} ${fromBank(rng, HOOK_VERBS)}`,
  buildScale: (rng) => ({ subject: fromBank(rng, WIDE_CLAUSES), verb: '' }),

  pickContradiction: (rng) => pairFromBank(rng, CONTRADICTION_PAIRS, new Set()),
  pickContrast: (rng) => pairFromBank(rng, CONTRAST_PAIRS, new Set()),
  pickQualifier: (rng) => fromBank(rng, QUALIFIERS),

  // Chart terms are English/Latin tokens, so the intro uses the hook instead.
  introLine: (ctx) => `(${ctx.topicWord ?? subjectAdlib(SUBJECT_MATERIAL, ctx) ?? ctx.hook})`,
  reframe: boundedReframe('latin'),

  metaphors: (family) => [...(METAPHORS[family] ?? []), ...METAPHORS.general.slice(0, 2)],

  render: {
    perspective: (count, ctx, used) => {
      const time = TIMES[Math.floor(ctx.rng() * TIMES.length)] ?? TIMES[0];
      const place = fromBank(ctx.rng, PLACES, used);
      // No "place, detail" concatenation line: joining two long phrases produced lines
      // of up to 21 syllables against an ~8.6 budget, which cost this pack ~40% of its
      // meter fit before the validator caught it.
      return takeLines(
        [
          `${time.lead} ${time.text} en ${place}`,
          `Estoy ${fromBank(ctx.rng, subjectSelves(SUBJECT_MATERIAL, ctx) ?? SELVES, used)}`,
          sentenceCase(fromBank(ctx.rng, DETAILS, used)),
        ],
        count,
      );
    },

    uncertainty: (count, ctx, used) =>
      takeLines(
        [
          `No sé si puedo ${fromBank(ctx.rng, UNCERTAIN_INFINITIVES, used)}`,
          `Quizá ${fromBank(ctx.rng, UNCERTAIN_CLAUSES, used)}`,
          `Aquí nada es ${fromBank(ctx.rng, UNCERTAIN_ADJECTIVES, used)}`,
          `Sigo ${fromBank(ctx.rng, CONTINUE_GERUNDS, used)}`,
        ],
        count,
      ),

    agency: (count, ctx, used) =>
      takeLines(
        [
          `Así que ${fromBank(ctx.rng, AGENCY_ACTIONS, used)}`,
          `Voy a ${fromBank(ctx.rng, PLANS, used)}`,
          `Esta vez ${fromBank(ctx.rng, CHOICES, used)}`,
          `Ya me cansé de ${fromBank(ctx.rng, DONE_INFINITIVES, used)}`,
        ],
        count,
      ),

    contradiction: (count, ctx) => {
      const [a, b] = ctx.contradiction;
      const [x, y] = ctx.contrast;
      return takeLines(
        [
          ctx.hook,
          `Yo ${a}, pero ${b}`,
          `Estoy ${x}, pero ${y}`,
          // Reuses the same first-person forms, so nothing needs an infinitive.
          `Yo ${a}, y sin embargo ${b}`,
        ],
        count,
      );
    },

    metaphor: (count, ctx) =>
      takeLines(
        [
          `Hay ${ctx.metaphor}`,
          'Y sigue siendo lo más alto',
          // Deliberately does not interpolate the metaphor: "Todo apunta a <long noun
          // phrase>" ran to 16 syllables, and restating the image also reads worse.
          'Y nadie lo mueve',
        ],
        count,
      ),

    scale: (count, ctx, used) =>
      takeLines(
        [
          // Split deliberately: joining this to the clause ran past the line budget.
          'Y no soy solo yo',
          sentenceCase(ctx.wideSubject),
          `Estamos todos ${fromBank(ctx.rng, WIDE_GERUNDS, used)}`,
        ],
        count,
      ),

    conclusion: (count, ctx, used) => {
      if (ctx.conclusion === 'reframed') {
        return Array.from({ length: Math.min(count, 2) }, () =>
          `(${spanishPack.reframe(ctx.hook, ctx.qualifier)})`,
        );
      }
      const time = TIMES[Math.floor(ctx.rng() * TIMES.length)] ?? TIMES[0];
      return takeLines(
        [
          fromBank(ctx.rng, bank(ctx, 'conclusion', UNRESOLVED), used),
          `En algún lugar ${time.lead.toLowerCase()} todavía ${time.text}`,
        ],
        count,
      );
    },
  },
};

