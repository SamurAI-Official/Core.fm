/**
 * Russian pack.
 *
 * Grammar decisions:
 *
 *  - **Past tense is gendered in Russian** ("сказал" vs "сказала") and the singer's
 *    gender is unknown, so the pack writes present and future forms only. Where the
 *    past is unavoidable it uses the *plural*, which is gender-neutral
 *    ("мы опоздали", "никто не выбрал");
 *  - prepositions govern cases, which cannot be assembled from parts, so places are
 *    stored as complete prepositional phrases ("на этой кухне", "в последнем вагоне")
 *    and the templates add no preposition - the same technique French needs for
 *    elision;
 *  - short neuter adjectives agree with "всё" and carry no person or gender, so
 *    self-descriptions are built from them rather than agreeing with the speaker;
 *  - word order is flexible, so lines can be composed by concatenation without
 *    breaking grammar - which is what lets this pack join banks the way it does;
 *  - the four cliches the validator already flags for `ru` are avoided deliberately:
 *    "сердце из золота", "танцевать под дождём", "освободи меня", "разорвать цепи".
 *
 * Meter note: the validator counts Cyrillic syllables as one per vowel, so every
 * bank here is written to land inside the comfortable band rather than to read as
 * prose. Two long phrases joined by a comma was the mistake the Portuguese pack
 * already paid for ("lost meter fit"), so lines stay short on purpose.
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
 * Complete lines: an agent chooses the order, so nothing here may rely on a template around it.
 * Present and future forms only, and impersonal or plural where the past would have to be
 * gendered - the same rule the rest of this pack follows.
 */
const PRIMITIVE_BANKS: Partial<Record<PrimitiveId, string[]>> = {
  question: [
    'Почему ты уходишь отсюда',
    'Куда ты идёшь, когда уходишь',
    'Кто теперь меня спасёт',
    'Что мне делать с остатком',
    'Сколько я держу этот свет',
    'Когда мы перестали быть мы',
  ],
  answer: [
    'Потому что я не могу остаться',
    'Никто, и никто не пришёл',
    'Я не знаю, и это правда',
    'Это никогда не было про меня',
    'Потому что кто-то должен был',
    'Я уже на середине пути',
  ],
  claim: [
    'Я обещаю не звонить',
    'Я говорю себе, что всё хорошо',
    'Говорят, что время лечит',
    'Я обещаю держаться в стороне',
    'Я повторяю: всё прошло',
  ],
  reversal: [
    'А потом набираю твой номер',
    'Но я всё ещё смотрю на дверь',
    'Тогда почему я помню',
    'Я уже на полпути назад',
    'На самом деле я не уходил',
  ],
  implication: [
    'Значит, кто-то перестал ждать',
    'Вот как выглядит уход',
    'Вот о чём была тишина',
    'Этот свет был не для меня',
    'Вот так это кончается',
  ],
  universal: [
    'Каждый что-то оставляет',
    'Никто не заберёт год с собой',
    'Мы все учим это одинаково',
    'Что-то кончается потом',
    'Нельзя держать и уходить',
  ],
  ladder: [
    'Я снова теряю ключи',
    'Я опаздываю на поезд',
    'Я пропускаю собеседование',
    'В марте я теряю работу',
    'Мне нечем платить за квартиру',
  ],
  deadline: [
    'Три дня до конца денег',
    'Одна ночь до поезда',
    'Десять рублей до выходных',
    'Два часа до закрытия',
    'Неделя до суда',
  ],
  fragment: ['Только дождь', 'Больше ничего', 'Только тишина', 'Всё ещё ничего', 'Никто не отвечает'],
};

/**
 * Subject material.
 *
 * `selves` completes "Я ...", so entries are present-tense first-person phrases with
 * no gender marking (the past tense would have to be gendered), and the closing lines
 * keep `UNRESOLVED`'s shape: short, complete sentences. Uncovered stages fall back to
 * the general bank.
 */
const SUBJECT_MATERIAL: SubjectTable = {
  'memory-and-loss': {
    adlib: 'фотография выцвела',
    selves: ['всё ещё считаю годы', 'рядом с тишиной', 'на том же месте'],
    banks: { conclusion: ['Ничего не стёрлось', 'Я помню это имя'] },
  },
  'leaving-and-staying': {
    adlib: 'свет на площадке',
    selves: ['всё ещё здесь', 'между двух прощаний', 'на том же месте'],
    banks: { conclusion: ['Мы ничего не решили', 'Это ещё не конец'] },
  },
  'starting-over': {
    adlib: 'ключ, который не подходит',
    selves: ['уже почти в пути', 'здесь недавно', 'на новой улице'],
    banks: { conclusion: ['Здесь не заканчивается', 'Завтра уже начало'] },
  },
};

/** Subject-aware bank lookup; any stage a subject omits uses the general bank. */
const bank = bankPicker(SUBJECT_MATERIAL);

/** Bare time phrases: the templates supply the copula, and Russian has none. */
const TIMES = ['полночь', 'четыре утра', 'золотой час', 'конец сезона', 'ещё одно воскресенье', 'время закрывать'];

/** Complete prepositional phrases: the case is already correct. */
const PLACES = [
  'на этой кухне',
  'в последнем вагоне',
  'в комнате без окон',
  'на восточной стороне',
  'в конце зала',
  'на съёмной квартире',
];

/**
 * Invariable self-descriptions that complete the sentence "Я ...", so no person or
 * gender agreement is required. ("здесь всё ещё" would have dangled.)
 */
const SELVES = ['всё ещё здесь', 'проездом', 'между двух прощаний', 'на том же месте', 'рядом с тишиной'];

/** Whole clauses, so no agreement has to be assembled at runtime. */
const DETAILS = [
  'та же кухня, другой год',
  'здесь ничего не сдвинулось',
  'вывеска всё ещё мигает',
  'никто не запер дверь',
  'радио играет то же самое',
];

const UNCERTAIN_INFINITIVES = ['удержать это', 'прочитать правильно', 'хотеть того же', 'остаться здесь', 'начать заново'];

/** Plural past: gender-neutral, and "мы" keeps the subject consistent. */
const UNCERTAIN_CLAUSES = [
  'мы слишком долго молчали',
  'мы просто шли мимо',
  'никто нас не выбрал',
  'мы опоздали на год',
  'мы не сказали главного',
];

/** Short neuter forms agreeing with "всё": no speaker agreement. */
const UNCERTAIN_ADJECTIVES = ['важно', 'просто', 'ясно', 'ново', 'знакомо'];

const CONTINUE = ['гляжу на дверь', 'повторяю слова', 'жду сигнала', 'считаю часы', 'переписываю финал'];

const AGENCY_ACTIONS = ['беру руль', 'отпускаю', 'плачу по счетам', 'ухожу без долгов', 'выбираю тишину'];

const PLANS = ['перестать притворяться', 'выучить это наизусть', 'сделать всё равно', 'просить большего'];

const CHOICES = ['выбираю молчание', 'иду вперёд', 'держу слово', 'беру длинную дорогу'];

/** After "Хватит": an infinitive needs no subject and no gender at all. */
const DONE_INFINITIVES = ['ждать погоды', 'просить разрешения', 'тянуть время'];

/** First-person present both sides, so "Я X, но Y" agrees and carries no gender. */
const CONTRADICTION_PAIRS: Array<[string, string]> = [
  ['отпускаю', 'держу крепко'],
  ['ухожу', 'остаюсь'],
  ['молчу', 'говорю громко'],
  ['стискиваю зубы', 'даю сорваться'],
  ['терплю падение', 'рассыпаюсь'],
  ['иду вперёд', 'остаюсь на ночь'],
  ['отменяю всё', 'всё равно прихожу'],
];

/** Impersonal neuter state + first-person verb: "Снаружи X, а внутри я Y". */
const CONTRAST_PAIRS: Array<[string, string]> = [
  ['спокойно', 'дрожу'],
  ['тихо', 'кричу'],
  ['ровно', 'рассыпаюсь'],
  ['легко', 'сомневаюсь'],
  ['ясно', 'вижу сон'],
];

/** Whole agreeing clauses: adjective + noun cannot be composed safely at runtime. */
const WIDE_CLAUSES = [
  'весь город ещё не спит',
  'каждое окно ещё следит',
  'весь район держит дыхание',
  'кто вернулся — тоже ждёт',
];

/** "Мы все" + first-person plural: no gender and no agreement risk. */
const WIDE_PLURALS = ['считаем те же часы', 'держим дыхание', 'ждём одного сигнала', 'не спим до утра'];

const QUALIFIERS = ['или что-то похожее', 'или почти', 'наверное', 'как-то так', 'или около того'];

const UNRESOLVED = ['Ничего не решено', 'Дверь так и осталась открытой', 'Мы всё ещё здесь'];

/**
 * Hook leads. "Всё ещё я" fronted the adverb and read as emphasis rather than the
 * plain statement a hook wants, so the adverb follows the pronoun instead.
 */
const HOOK_LEADS = ['Я', 'И снова я', 'А я', 'Я всё ещё'];

const HOOK_VERBS = ['держу эту дверь', 'стою на пороге', 'считаю часы', 'не отпускаю', 'жду сигнала'];

/** Metaphor objects per family, used in object position after "Есть". */
const METAPHORS: Record<string, string[]> = {
  roots: ['экранная дверь, что не закрывается', 'кофе на заправке остыл', 'твоё имя на пыли торпедо'],
  urban: ['трещина на экране телефона', 'деньги, сложенные в коробку', 'фонарь сквозь жалюзи'],
  club: ['стробоскоп, что держит ритм', 'бас, идущий через пол', 'экран, который не гаснет'],
  band: ['струна, готовая лопнуть', 'спичка, что не зажглась', 'усилитель, что гудит всю ночь'],
  afro: ['ботинки, стёртые до пят', 'чайник, свистящий на рассвете', 'генератор, что всегда заводится'],
  eastasia: ['зонт, забытый в поезде', 'кассета, которая ещё играет', 'сообщение, набранное и стёртое'],
  latin: ['записка, сложенная в кармане', 'смятый дважды билет', 'стул, который никто не занял'],
  southasia: ['лампа, что горит всю ночь', 'письма, сложенные у двери', 'поезд, что уходит без меня'],
  quiet: ['открытое окно', 'пыль в солнечном луче', 'коридор с погашенным светом'],
  europe: ['чайник, оставленный на огне', 'карта, сложенная не так', 'велосипед у забора'],
  general: ['открытая дверь', 'телефон, который молчит', 'ключ, что больше не подходит'],
};

export const russianPack: LanguagePack = {
  code: 'ru',
  label: 'Russian',
  nativeLabel: 'Русский',
  script: 'cyrillic',
  complete: true,
  subjectCoverage: subjectIdsOf(SUBJECT_MATERIAL),
  primitives: PRIMITIVE_BANKS,

  buildHook: (rng) => `${fromBank(rng, HOOK_LEADS)} ${fromBank(rng, HOOK_VERBS)}`,
  buildScale: (rng) => ({ subject: fromBank(rng, WIDE_CLAUSES), verb: '' }),

  pickContradiction: (rng) => pairFromBank(rng, CONTRADICTION_PAIRS, new Set()),
  pickContrast: (rng) => pairFromBank(rng, CONTRAST_PAIRS, new Set()),
  pickQualifier: (rng) => fromBank(rng, QUALIFIERS),

  // Chart terms arrive in the market's script; the subject ad-lib is the pack's own,
  // so the intro says something about this song even on a Latin-script chart.
  introLine: (ctx) => `(${subjectAdlib(SUBJECT_MATERIAL, ctx) ?? ctx.hook})`,
  reframe: boundedReframe('cyrillic'),

  metaphors: (family) => [...(METAPHORS[family] ?? []), ...METAPHORS.general.slice(0, 2)],

  render: {
    perspective: (count, ctx, used) => {
      const time = fromBank(ctx.rng, TIMES, used);
      const place = fromBank(ctx.rng, PLACES, used);
      // No comma between time and place: "Сейчас полночь, на этой кухне" read as two
      // fragments, and the joined form stays inside the meter band.
      return takeLines(
        [
          `Сейчас ${time} ${place}`,
          `Я ${fromBank(ctx.rng, subjectSelves(SUBJECT_MATERIAL, ctx) ?? SELVES, used)}`,
          sentenceCase(fromBank(ctx.rng, DETAILS, used)),
        ],
        count,
      );
    },

    uncertainty: (count, ctx, used) =>
      takeLines(
        [
          `Не знаю, смогу ли ${fromBank(ctx.rng, UNCERTAIN_INFINITIVES, used)}`,
          `Может, ${fromBank(ctx.rng, UNCERTAIN_CLAUSES, used)}`,
          `Здесь всё не ${fromBank(ctx.rng, UNCERTAIN_ADJECTIVES, used)}`,
          `Всё ещё ${fromBank(ctx.rng, CONTINUE, used)}`,
        ],
        count,
      ),

    agency: (count, ctx, used) =>
      takeLines(
        [
          `И вот ${fromBank(ctx.rng, AGENCY_ACTIONS, used)}`,
          `Решаю ${fromBank(ctx.rng, PLANS, used)}`,
          `В этот раз ${fromBank(ctx.rng, CHOICES, used)}`,
          `Хватит ${fromBank(ctx.rng, DONE_INFINITIVES, used)}`,
        ],
        count,
      ),

    contradiction: (count, ctx) => {
      const [a, b] = ctx.contradiction;
      const [x, y] = ctx.contrast;
      return takeLines(
        [
          ctx.hook,
          `Я ${a}, но ${b}`,
          `Снаружи ${x}, а внутри я ${y}`,
          `Я ${a}, и всё-таки ${b}`,
        ],
        count,
      );
    },

    metaphor: (count, ctx) =>
      takeLines(
        [
          `Есть ${ctx.metaphor}`,
          'И это самое громкое',
          // Deliberately does not interpolate the metaphor: the concatenation ran long.
          'И никто не заберёт',
        ],
        count,
      ),

    scale: (count, ctx, used) =>
      takeLines(
        [
          'И не только я',
          sentenceCase(ctx.wideSubject),
          `Мы все ${fromBank(ctx.rng, WIDE_PLURALS, used)}`,
        ],
        count,
      ),

    conclusion: (count, ctx, used) => {
      if (ctx.conclusion === 'reframed') {
        return Array.from({ length: Math.min(count, 2) }, () =>
          `(${russianPack.reframe(ctx.hook, ctx.qualifier)})`,
        );
      }
      return takeLines(
        [
          fromBank(ctx.rng, bank(ctx, 'conclusion', UNRESOLVED), used),
          `Где-то всё ещё ${fromBank(ctx.rng, TIMES, used)}`,
        ],
        count,
      );
    },
  },
};


