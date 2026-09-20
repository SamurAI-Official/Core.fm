/**
 * French pack.
 *
 * Grammar decisions that make this French rather than translated English:
 *
 *  - "on" is the collective subject (takes a third-person *singular* verb), which
 *    gives a natural "we" without any plural agreement to get wrong;
 *  - predicative adjectives are avoided entirely where they would need gender
 *    agreement ("je suis pret/prête"), so self-descriptions are adverbial;
 *  - elision is pre-baked into the bank entries ("de partir" vs "d'attendre")
 *    rather than computed, because it depends on the following word's first
 *    sound, not a rule that can be applied safely at runtime;
 *  - the scale expansion uses whole already-agreeing clauses ("toute la ville
 *    reste éveillée") instead of composing adjective + noun at runtime, which is
 *    impossible to do correctly without knowing each noun's gender.
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
 * Subject material.
 *
 * Fragment-level on purpose: the ad-lib is a noun phrase, `selves` completes
 * "Je suis ..." (so it stays adverbial, the way `SELVES` is), and the closing lines
 * keep the shape of `UNRESOLVED` - complete, short sentences. Deeper coverage
 * (uncertainty, agency) can be added the same way once each line has been checked by
 * a speaker, which is why partial coverage is safe: any slot a subject omits falls
 * back to the general bank.
 */
const SUBJECT_MATERIAL: SubjectTable = {
  'leaving-and-staying': {
    adlib: 'la lumière du palier',
    selves: ['encore là', 'à la même place', 'entre deux départs'],
    banks: { conclusion: ["On n'a rien décidé", "Ce n'est pas la fin"] },
  },
  'city-and-work': {
    adlib: 'le dernier service',
    selves: ['encore de nuit', 'entre deux services', 'ici depuis peu'],
    banks: { conclusion: ['Le loyer tombe le premier', "Personne ne l'a dit"] },
  },
  'memory-and-loss': {
    adlib: 'une photo fanée',
    selves: ['du côté du silence', 'à la même place', 'encore là'],
    banks: { conclusion: ["Rien ne s'est effacé", "Quelqu'un a laissé la lumière"] },
  },
};

/**
 * Whole-line primitives for styles that place lines themselves (see `primitives.ts`).
 *
 * Complete lines, not fragments: an agent decides the order, so a question has to read as a
 * question and a confession has to stand alone wherever they land. Elision and gender are already
 * resolved inside each entry ("j'ai", "je ne suis jamais parti"), because no template surrounds it.
 */
const PRIMITIVE_BANKS: Partial<Record<PrimitiveId, string[]>> = {
  question: [
    'Pourquoi tu es parti',
    'Où tu vas quand tu pars',
    'Qui va me sauver maintenant',
    "Qu'est-ce que je fais du reste",
    'Combien de temps je garde la lumière',
    "Quand on a cessé d'être nous",
  ],
  answer: [
    'Parce que je ne pouvais pas rester',
    'Personne, et personne est venu',
    "Je ne sais pas, et c'est la vérité",
    "Ce n'était jamais à propos de moi",
    "Parce que quelqu'un devait le faire",
    "J'étais déjà à moitié parti",
  ],
  claim: [
    "J'ai dit que je n'appellerais pas",
    'Je me suis dit que ça allait',
    'On dit que le temps répare',
    "J'avais promis de rester loin",
    "Je répète que c'est fini",
  ],
  reversal: [
    "Et j'ai composé ton numéro",
    'Mais je regarde encore la porte',
    "Alors pourquoi je m'en souviens",
    "J'étais déjà à mi-chemin",
    'En fait je ne suis jamais parti',
  ],
  implication: [
    "Ça veut dire qu'on a cessé d'attendre",
    'Voilà à quoi ressemble partir',
    "C'était ça, le silence",
    "Cette lumière n'était pas pour moi",
    'Ça se termine comme ça',
  ],
  universal: [
    'Tout le monde laisse quelque chose',
    "Personne ne garde l'année",
    "On l'apprend tous pareil",
    'Certaines choses finissent après coup',
    'On ne peut pas tenir et partir',
  ],
  ladder: [
    "J'ai encore perdu les clés",
    "J'ai raté le dernier train",
    "J'ai raté l'entretien",
    "J'ai perdu le boulot en mars",
    'Je ne peux pas payer le loyer',
  ],
  deadline: [
    "Trois jours avant la fin de l'argent",
    'Une nuit avant le départ du train',
    "Dix euros jusqu'à la fin du mois",
    'Deux heures avant la fermeture',
    "Une semaine avant l'audience",
  ],
  fragment: ['Juste la pluie', "Rien d'autre", 'Seulement le silence', 'Toujours rien', 'Personne ne répond'],
};

/** Subject-aware bank lookup; any stage a subject omits uses the general bank. */
const bank = bankPicker(SUBJECT_MATERIAL);

/** Time expressions carry their own lead so "il est minuit" / "c'est l'aube" both work. */
const TIMES: Array<{ lead: string; text: string }> = [
  { lead: 'Il est', text: 'minuit' },
  { lead: "C'est", text: "l'heure dorée" },
  { lead: "C'est", text: 'la fin de la saison' },
  { lead: "C'est", text: 'un dimanche de plus' },
  { lead: 'Il est', text: 'quatre heures du matin' },
  { lead: "C'est", text: 'la fermeture' },
];

/** Preposition is stored with the place, so "sur une chambre" cannot happen. */
const ON_PLACES = ['cette rue', 'le côté est', 'une route sans issue', 'le dernier bus'];
const IN_PLACES = ['une chambre louée', "l'épicerie du coin", 'une voiture empruntée', 'le fond de la salle'];

/** Adverbial self-descriptions: no gender agreement required. */
const SELVES = ['encore là', 'ici depuis peu', 'à la même place', 'entre deux départs', 'du côté du silence'];

const DETAILS = [
  'la même cuisine, une autre année',
  "rien n'a bougé ici",
  "l'enseigne clignote encore",
  "personne n'a fermé la porte",
  'la radio passe toujours les mêmes chansons',
];

const UNCERTAIN_INFINITIVES = ['tenir ça', 'bien lire', 'vouloir la même chose', 'rester ici', 'recommencer'];
const UNCERTAIN_CLAUSES = [
  "on s'est trompé",
  'on partait déjà',
  "on n'a jamais eu le choix",
  'on ne faisait que passer',
  "on l'a dit trop tard",
];
const UNCERTAIN_ADJECTIVES = ['certain', 'simple', 'fini', 'à moi', 'réglé'];
const CONTINUE_INFINITIVES = ['vérifier la porte', 'répéter les mots', 'attendre un signe', 'compter les heures', 'réécrire la fin'];

/** Entries include the correct elided preposition ("de partir" / "d'attendre"). */
const DECIDE_INFINITIVES = ['de partir', "d'appeler", "d'attendre", 'de payer le prix', 'de tout laisser'];
const PLANS = ['arrêter de faire semblant', 'apprendre à la dure', 'le faire quand même', 'demander plus'];
const CHOICES = ['choisis le silence', 'passe devant', 'tiens parole', 'prends la longue route'];
const DONE_INFINITIVES = ["d'attendre la météo", 'de demander la permission', 'de dormir dessus'];

/** First-person singular present, so "je X, mais je Y" always agrees. */
const CONTRADICTION_PAIRS: Array<[string, string]> = [
  ['laisse tomber', 'tiens bon'],
  ["m'en vais", 'reste encore'],
  ['garde le silence', 'le dis fort'],
  ['serre les dents', 'laisse glisser'],
  ['amortis la chute', "m'effondre"],
  ['avance', 'reste cette nuit'],
  ['annule tout', 'me présente quand même'],
];

/**
 * Elision: "je" contracts to "j'" before a vowel or a mute h.
 *
 * Computed rather than hand-written into the banks, because a bank entry starting
 * with a vowel ("amortis la chute") produced "Je amortis" - the same class of
 * error as a missing accent, and one listeners notice immediately.
 */
function je(phrase: string): string {
  return /^[aeiouâàäéèêëîïôöûüùyh]/i.test(phrase) ? `j'${phrase}` : `je ${phrase}`;
}

/** Invariable or first-person-safe qualities, paired with a first-person verb. */
const CONTRAST_PAIRS: Array<[string, string]> = [
  ['tranquille', 'tremble'],
  ['calme', 'brûle'],
  ['sincère', 'me cache'],
  ['debout', 'rêve encore'],
  ['au large', 'ai froid'],
];

/**
 * Whole agreeing clauses - see the header note on gendered agreement.
 * Kept to ~8-11 syllables each: the validator flagged the longer drafts as
 * unsingable at 100 BPM once a template prefix was added.
 */
const WIDE_CLAUSES = [
  'toute la ville reste éveillée',
  'chaque fenêtre allumée veille encore',
  'tous ceux qui rentrent comptent aussi',
  'le quartier entier retient son souffle',
  'on est tous debout dans la même nuit',
];

const WIDE_INFINITIVES = ['attendre le même train', 'apprendre la même chanson', 'compter les mêmes heures', 'tenir la même porte'];

const UNRESOLVED = [
  'Et je ne sais toujours pas',
  "On n'a jamais décidé",
  "C'est peut-être assez",
  "Ce n'est pas fini",
  "Personne n'a dit la fin",
];

const QUALIFIERS = ['ou peut-être pas', "pour l'instant", 'ou quelque chose comme ça', 'juste pour cette nuit'];

/**
 * Hook verbs are subject-free: the lead already supplies "on", so a verb phrase
 * containing "on" would render "On on garde la lumiere allumee".
 * All are third-person singular, agreeing with "on".
 */
const HOOK_VERBS = [
  'garde la lumière allumée',
  'le dit en premier',
  "tient jusqu'au matin",
  'prend le chemin long',
  'compte deux fois',
  'monte le son',
  'attend que ça passe',
  'laisse la porte ouverte',
  'appelle ça notre histoire',
];

const HOOK_LEADS = ['On', 'Toi et moi, on', 'Nous deux, on', 'Tout le monde ici, on'];

/** Metaphor objects per register, written as French objects rather than translations. */
const METAPHORS: Record<string, string[]> = {
  roots: ['un portail qui grince', 'une clôture à réparer', 'un chien qui attend dehors', 'la route de terre après la pluie'],
  urban: ["un hall d'immeuble éclairé", 'une porte laissée ouverte', 'un téléphone sans réponse', "l'escalier B au sixième"],
  club: ['un stroboscope qui garde le temps', "une basse qui ne s'arrête pas", 'la lumière du plafond qui tourne'],
  band: ['une guitare désaccordée', 'un ampli qui souffle', 'le fond de la salle'],
  afro: ['un pagne plié en anneau', 'une moto qui passe trop vite', 'la poussière au coucher du soleil'],
  eastasia: ['un parapluie oublié dans le train', 'une pièce de cent yens', 'un distributeur qui bourdonne'],
  latin: ['une chaise en plastique sur le trottoir', 'une radio sur le balcon', 'une glacière qui fuit'],
  southasia: ['un thé sucré qui refroidit', 'des sandales à la porte', 'un ventilateur qui tourne'],
  quiet: ['une horloge qui avance trop fort', 'une chaise vide en face', 'la buée sur la fenêtre'],
  europe: ['un ticket de train plié', 'un verre encore plein', 'une lettre jamais envoyée'],
  general: ['une clé qui ne sert plus', 'un manteau trop léger', 'la lumière du couloir', 'un nom écrit au crayon'],
};

export const frenchPack: LanguagePack = {
  code: 'fr',
  label: 'French',
  nativeLabel: 'Français',
  script: 'latin',
  complete: true,
  subjectCoverage: subjectIdsOf(SUBJECT_MATERIAL),
  primitives: PRIMITIVE_BANKS,

  buildHook: (rng) => `${fromBank(rng, HOOK_LEADS)} ${fromBank(rng, HOOK_VERBS)}`,

  // The clause is already complete and agreed; there is no separate verb to add.
  buildScale: (rng) => ({ subject: fromBank(rng, WIDE_CLAUSES), verb: '' }),

  pickContradiction: (rng) => pairFromBank(rng, CONTRADICTION_PAIRS, new Set()),
  pickContrast: (rng) => pairFromBank(rng, CONTRAST_PAIRS, new Set()),
  pickQualifier: (rng) => fromBank(rng, QUALIFIERS),

  // Chart terms are English/Latin tokens, so this pack uses the hook instead of
  // injecting a foreign word into the intro ad-lib.
  introLine: (ctx) => `(${subjectAdlib(SUBJECT_MATERIAL, ctx) ?? ctx.hook})`,
  reframe: boundedReframe('latin'),

  metaphors: (family) => [...(METAPHORS[family] ?? []), ...METAPHORS.general.slice(0, 2)],

  render: {
    perspective: (count, ctx, used) => {
      const time = TIMES[Math.floor(ctx.rng() * TIMES.length)] ?? TIMES[0];
      const useOn = ctx.rng() < 0.5;
      const place = fromBank(ctx.rng, useOn ? ON_PLACES : IN_PLACES, used);
      const self = fromBank(ctx.rng, subjectSelves(SUBJECT_MATERIAL, ctx) ?? SELVES, used);
      const detail = fromBank(ctx.rng, DETAILS, used);
      return takeLines(
        [
          `${time.lead} ${time.text} ${useOn ? 'sur' : 'dans'} ${place}`,
          `Je suis ${self}`,
          sentenceCase(detail),
          `${sentenceCase(place)}, ${detail}`,
        ],
        count,
      );
    },

    uncertainty: (count, ctx, used) =>
      takeLines(
        [
          `Je ne sais pas si je peux ${fromBank(ctx.rng, UNCERTAIN_INFINITIVES, used)}`,
          // Every clause begins with "on", so the elided "qu'" is always correct.
          `Peut-être qu'${fromBank(ctx.rng, UNCERTAIN_CLAUSES, used)}`,
          `Rien ici n'est ${fromBank(ctx.rng, UNCERTAIN_ADJECTIVES, used)}`,
          `Je continue à ${fromBank(ctx.rng, CONTINUE_INFINITIVES, used)}`,
        ],
        count,
      ),

    agency: (count, ctx, used) =>
      takeLines(
        [
          `Alors je décide ${fromBank(ctx.rng, DECIDE_INFINITIVES, used)}`,
          `Je vais ${fromBank(ctx.rng, PLANS, used)}`,
          `Cette fois ${je(fromBank(ctx.rng, CHOICES, used))}`,
          `J'ai fini ${fromBank(ctx.rng, DONE_INFINITIVES, used)}`,
        ],
        count,
      ),

    contradiction: (count, ctx) => {
      const [a, b] = ctx.contradiction;
      const [x, y] = ctx.contrast;
      return takeLines(
        [
          ctx.hook,
          sentenceCase(`${je(a)}, mais ${je(b)}`),
          `Je suis ${x}, et ${je(y)}`,
          // Reuses the same first-person forms, so nothing needs an infinitive.
          sentenceCase(`${je(a)}, et pourtant ${je(b)}`),
        ],
        count,
      );
    },

    metaphor: (count, ctx) =>
      takeLines(
        [
          `Il y a ${ctx.metaphor}`,
          "Et c'est encore la chose la plus forte ici",
          `Tout pointe vers ${ctx.metaphor}`,
        ],
        count,
      ),

    scale: (count, ctx, used) =>
      takeLines(
        [
          // Split deliberately: "Ce n'est pas que moi, <clause>" ran to ~15
          // syllables against a ~10-syllable budget at 100 BPM.
          "Et ce n'est pas que moi",
          sentenceCase(ctx.wideSubject),
          `On est tous en train de ${fromBank(ctx.rng, WIDE_INFINITIVES, used)}`,
        ],
        count,
      ),

    conclusion: (count, ctx, used) => {
      if (ctx.conclusion === 'reframed') {
        return Array.from({ length: Math.min(count, 2) }, () =>
          `(${frenchPack.reframe(ctx.hook, ctx.qualifier)})`,
        );
      }
      const time = TIMES[Math.floor(ctx.rng() * TIMES.length)] ?? TIMES[0];
      return takeLines(
        [
          fromBank(ctx.rng, bank(ctx, 'conclusion', UNRESOLVED), used),
          `Quelque part, ${time.lead.toLowerCase()} encore ${time.text}`,
        ],
        count,
      );
    },
  },
};