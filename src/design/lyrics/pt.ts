/**
 * Brazilian Portuguese pack (pt-BR).
 *
 * Grammar decisions:
 *
 *  - "em" contracts with articles ("em + a" -> "na", "em + o" -> "no"), which cannot
 *    be assembled from parts, so places are stored as complete prepositional phrases
 *    ("nessa rua", "no lado leste") and the template adds no preposition - the same
 *    technique French needs for elision;
 *  - "a gente" is the natural colloquial Brazilian subject and takes a third-person
 *    *singular* verb, so plural agreement cannot go wrong;
 *  - predicative adjectives are avoided where they would need gender agreement, via
 *    invariable adverbial phrases;
 *  - time expressions carry their own copula so "É meia-noite" and "São quatro" are
 *    both correct.
 */
import {
  bankPicker,
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

/**
 * Subject material.
 *
 * `selves` completes "Estou ...", so every entry is invariable (no gender agreement),
 * matching how `SELVES` is written; closing lines are complete short sentences.
 * Uncovered stages fall back to the general bank.
 */
const SUBJECT_MATERIAL: SubjectTable = {
  'celebration-and-hustle': {
    adlib: 'a última música da noite',
    selves: ['ainda na pista', 'no meio da festa', 'sem sono'],
    banks: { conclusion: ['E a noite ainda não acabou', 'A gente continua aqui'] },
  },
  'starting-over': {
    adlib: 'uma chave que não serve mais',
    selves: ['quase na estrada', 'de mudança', 'aqui de passagem'],
    banks: { conclusion: ['Não é aqui que termina', 'Amanhã já é um começo'] },
  },
  'memory-and-loss': {
    adlib: 'uma foto desbotada',
    selves: ['ainda contando os anos', 'do lado do silêncio', 'no mesmo lugar'],
    banks: { conclusion: ['Nada se apagou', 'Ainda sei o caminho de volta'] },
  },
};

/** Subject-aware bank lookup; any stage a subject omits uses the general bank. */
const bank = bankPicker(SUBJECT_MATERIAL);

const TIMES: Array<{ lead: string; text: string }> = [
  { lead: 'É', text: 'meia-noite' },
  { lead: 'É', text: 'a hora dourada' },
  { lead: 'É', text: 'o fim da temporada' },
  { lead: 'É', text: 'mais um domingo' },
  { lead: 'São', text: 'quatro da manhã' },
  { lead: 'É', text: 'a hora de fechar' },
];

/** Complete prepositional phrases: the contraction is already correct. */
const PLACES = ['nessa rua', 'no lado leste', 'numa estrada sem saída', 'no último ônibus', 'num quarto alugado', 'no fundo do salão'];

/** Invariable self-descriptions: no gender agreement required. */
const SELVES = ['aqui ainda', 'de passagem', 'entre dois adeuses', 'no mesmo lugar', 'do lado do silêncio'];

const DETAILS = [
  'a mesma cozinha, outro ano',
  'aqui nada se moveu',
  'a placa ainda pisca',
  'ninguém trancou a porta',
  'o rádio toca o mesmo',
];

const UNCERTAIN_INFINITIVES = ['segurar isso', 'ler direito', 'querer o mesmo', 'ficar aqui', 'começar de novo'];

/** "a gente" + subjunctive: natural Brazilian Portuguese, no plural agreement. */
const UNCERTAIN_CLAUSES = ['a gente tenha errado', 'a gente já estivesse indo', 'nunca tivemos escolha', 'a gente só passava por aqui', 'dissemos tarde demais'];

const UNCERTAIN_ADJECTIVES = ['certo', 'simples', 'meu', 'definitivo', 'claro'];

const CONTINUE_GERUNDS = ['olhando a porta', 'repetindo as palavras', 'esperando um sinal', 'contando as horas', 'reescrevendo o final'];

const AGENCY_ACTIONS = ['pego o volante', 'deixo ir', 'digo primeiro', 'pago o preço', 'saio limpo'];

const PLANS = ['parar de fingir', 'aprender do jeito difícil', 'fazer mesmo assim', 'pedir mais'];

const CHOICES = ['escolho o silêncio', 'vou primeiro', 'cumpro a palavra', 'pego o caminho longo'];

const DONE_INFINITIVES = ['esperar o tempo', 'pedir licença', 'empurrar com a barriga'];

/** First-person singular both sides, so "Eu X, mas Y" always agrees. */
const CONTRADICTION_PAIRS: Array<[string, string]> = [
  ['deixo ir', 'seguro firme'],
  ['vou embora', 'fico'],
  ['me calo', 'falo alto'],
  ['aperto os dentes', 'deixo escapar'],
  ['aguento o tombo', 'desmorono'],
  ['sigo em frente', 'fico essa noite'],
  ['cancelo tudo', 'apareço mesmo assim'],
];

/** Invariable adverbial qualities paired with a first-person verb. */
const CONTRAST_PAIRS: Array<[string, string]> = [
  ['em paz', 'tremo'],
  ['de pé', 'desmorono'],
  ['sem medo', 'duvido'],
  ['no limite', 'sorrio'],
  ['em claro', 'sonho'],
];

/** Whole agreeing clauses - see the header note on gender agreement. */
const WIDE_CLAUSES = [
  'a cidade toda continua acordada',
  'cada janela acesa ainda vigia',
  'quem volta pra casa conta as mesmas horas',
  'o bairro inteiro segura a respiração',
  'estamos todos na mesma noite',
];

const WIDE_GERUNDS = ['esperando o mesmo trem', 'aprendendo a mesma canção', 'contando as mesmas horas', 'segurando a mesma porta'];

const UNRESOLVED = [
  'E eu ainda não sei',
  'A gente nunca decidiu',
  'Talvez seja o bastante',
  'Isso não acabou',
  'Ninguém disse o fim',
];

const QUALIFIERS = ['ou talvez não', 'por enquanto', 'ou algo parecido', 'só por essa noite'];

/** Subject-free third-person-singular verbs: the lead supplies "a gente". */
const HOOK_VERBS = [
  'deixa a luz acesa',
  'diz primeiro',
  'aguenta até o fim',
  'pega o caminho longo',
  'conta duas vezes',
  'sobe o volume',
  'deixa a porta aberta',
  'chama de nosso',
];

/**
 * Every lead contains "a gente", because that is what the 3rd-person-singular hook
 * verbs agree with. A lead like "Eu e você" would need a 1st-person-plural verb and
 * mixing the two produces non-standard agreement.
 */
const HOOK_LEADS = ['A gente', 'Aqui, a gente', 'Nós dois, a gente', 'Todo mundo, a gente'];

/** Metaphors as Brazilian objects, not translations of the English bank. */
const METAPHORS: Record<string, string[]> = {
  roots: ['um portão que range', 'uma cerca pra consertar', 'um cachorro esperando lá fora', 'a estrada de terra depois da chuva'],
  urban: ['um corredor iluminado', 'uma porta deixada aberta', 'um telefone que não toca', 'o sexto andar do bloco B'],
  club: ['um estrobo que marca o tempo', 'um baixo que não para', 'a luz do teto girando'],
  band: ['uma guitarra desafinada', 'um amplificador chiando', 'o fundo do salão'],
  afro: ['um pano dobrado em anel', 'uma moto passando rápido demais', 'a poeira no fim da tarde'],
  eastasia: ['um guarda-chuva esquecido no trem', 'uma moeda na máquina', 'uma máquina zumbindo'],
  latin: ['uma cadeira de plástico na calçada', 'um rádio na varanda', 'uma geladeira pingando'],
  southasia: ['um chá doce esfriando', 'sandálias na porta', 'um ventilador girando'],
  quiet: ['um relógio alto demais', 'uma cadeira vazia na frente', 'o embaçado no vidro'],
  europe: ['um bilhete de trem dobrado', 'um copo ainda cheio', 'uma carta nunca enviada'],
  general: ['uma chave que não serve mais', 'um casaco leve demais', 'a luz do corredor', 'um nome escrito a lápis'],
};

export const portuguesePack: LanguagePack = {
  code: 'pt',
  label: 'Portuguese (Brazil)',
  nativeLabel: 'Português (Brasil)',
  script: 'latin',
  complete: true,
  subjectCoverage: subjectIdsOf(SUBJECT_MATERIAL),

  buildHook: (rng) => `${fromBank(rng, HOOK_LEADS)} ${fromBank(rng, HOOK_VERBS)}`,
  buildScale: (rng) => ({ subject: fromBank(rng, WIDE_CLAUSES), verb: '' }),

  pickContradiction: (rng) => pairFromBank(rng, CONTRADICTION_PAIRS, new Set()),
  pickContrast: (rng) => pairFromBank(rng, CONTRAST_PAIRS, new Set()),
  pickQualifier: (rng) => fromBank(rng, QUALIFIERS),

  // Chart terms are English/Latin tokens, so the intro uses the hook instead.
  introLine: (ctx) => `(${subjectAdlib(SUBJECT_MATERIAL, ctx) ?? ctx.hook})`,
  reframe: (hook, qualifier) => `${hook}, ${qualifier}`,

  metaphors: (family) => [...(METAPHORS[family] ?? []), ...METAPHORS.general.slice(0, 2)],

  render: {
    perspective: (count, ctx, used) => {
      const time = TIMES[Math.floor(ctx.rng() * TIMES.length)] ?? TIMES[0];
      const place = fromBank(ctx.rng, PLACES, used);
      // No "place, detail" concatenation: two long phrases joined ran past the meter
      // band, which the validator caught as lost meter fit.
      return takeLines(
        [
          `${time.lead} ${time.text} ${place}`,
          `Estou ${fromBank(ctx.rng, subjectSelves(SUBJECT_MATERIAL, ctx) ?? SELVES, used)}`,
          sentenceCase(fromBank(ctx.rng, DETAILS, used)),
        ],
        count,
      );
    },

    uncertainty: (count, ctx, used) =>
      takeLines(
        [
          `Não sei se consigo ${fromBank(ctx.rng, UNCERTAIN_INFINITIVES, used)}`,
          `Talvez ${fromBank(ctx.rng, UNCERTAIN_CLAUSES, used)}`,
          `Aqui nada é ${fromBank(ctx.rng, UNCERTAIN_ADJECTIVES, used)}`,
          `Continuo ${fromBank(ctx.rng, CONTINUE_GERUNDS, used)}`,
        ],
        count,
      ),

    agency: (count, ctx, used) =>
      takeLines(
        [
          `Então ${fromBank(ctx.rng, AGENCY_ACTIONS, used)}`,
          `Vou ${fromBank(ctx.rng, PLANS, used)}`,
          `Dessa vez ${fromBank(ctx.rng, CHOICES, used)}`,
          `Cansei de ${fromBank(ctx.rng, DONE_INFINITIVES, used)}`,
        ],
        count,
      ),

    contradiction: (count, ctx) => {
      const [a, b] = ctx.contradiction;
      const [x, y] = ctx.contrast;
      return takeLines(
        [
          ctx.hook,
          `Eu ${a}, mas ${b}`,
          `Estou ${x}, mas ${y}`,
          `Eu ${a}, e mesmo assim ${b}`,
        ],
        count,
      );
    },

    metaphor: (count, ctx) =>
      takeLines(
        [
          `Tem ${ctx.metaphor}`,
          'E ainda é a mais alta',
          // Deliberately does not interpolate the metaphor: the concatenation ran long.
          'E ninguém tira',
        ],
        count,
      ),

    scale: (count, ctx, used) =>
      takeLines(
        [
          'E não sou só eu',
          sentenceCase(ctx.wideSubject),
          `Estamos todos ${fromBank(ctx.rng, WIDE_GERUNDS, used)}`,
        ],
        count,
      ),

    conclusion: (count, ctx, used) => {
      if (ctx.conclusion === 'reframed') {
        return Array.from({ length: Math.min(count, 2) }, () =>
          `(${portuguesePack.reframe(ctx.hook, ctx.qualifier)})`,
        );
      }
      const time = TIMES[Math.floor(ctx.rng() * TIMES.length)] ?? TIMES[0];
      return takeLines(
        [
          fromBank(ctx.rng, bank(ctx, 'conclusion', UNRESOLVED), used),
          `Em algum lugar ${time.lead.toLowerCase()} ainda ${time.text}`,
        ],
        count,
      );
    },
  },
};

