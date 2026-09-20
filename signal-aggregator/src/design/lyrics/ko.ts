/**
 * Korean pack (Hangul).
 *
 * Grammar decisions:
 *
 *  - **No plurals, no gender, no adjective agreement**: Korean needs neither number
 *    agreement nor gendered forms, so the constraints that shape the French and
 *    German packs (elision, gendered predicates) simply do not apply here;
 *  - **particles are pre-baked into the bank entries**, never appended at runtime,
 *    because 은/는 vs 이/가 and 을/를 are chosen by whether the preceding syllable has
 *    a final consonant (받침). Places therefore arrive as complete locative phrases
 *    ("이 거리에서"), exactly the technique French needs for elision;
 *  - **plain style (한다/해체) throughout**: honorific levels are a register choice,
 *    not a lyric one, and mixing them inside one song is the flaw a listener notices
 *    first;
 *  - **bare time nouns** ("자정") rather than copula sentences, because Korean
 *    narrative lyrics drop the copula and a wrong 하나/입니다 form is worse than none;
 *  - lines are written to the Hangul meter model (one syllable per block), so each
 *    line lands inside the comfortable band instead of reading as prose.
 *
 * The four cliches the validator already flags for `ko` are avoided deliberately:
 * "황금 같은 마음", "비 속에서 춤추다", "나를 놓아줘", "사슬을 끊어".
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

/** Bare time nouns: no copula, so no politeness level to get wrong. */
const TIMES = ['자정', '해 뜨기 전', '노을 무렵', '막차 시간', '또 한 번의 일요일', '문을 닫는 시간'];

/** Complete locative phrases: the particle is already correct. */
const PLACES = ['이 거리에서', '동쪽 끝에서', '막다른 길에서', '막차 안에서', '빌린 방에서', '공연장 뒤편에서'];

/** Completes "나는 ...". No gender or number marking is needed. */
const SELVES = ['아직 여기 있어', '아직 이 도시가 낯설어', '두 번의 이별 사이에 있어', '같은 자리에 있어', '조용한 쪽에 있어'];

/** Standalone clauses, also readable after a place ("이 거리에서, ..."). */
const DETAILS = [
  '같은 부엌, 다른 해',
  '여기선 아무것도 안 움직였어',
  '간판은 아직 깜빡여',
  '아무도 문을 잠그지 않았어',
  '라디오는 같은 노래만 틀어',
];

/** Standalone uncertainty clauses. */
const UNCERTAIN_CLAUSES = [
  '나는 잘 모르겠어',
  '어쩌면 우리는 늦었어',
  '여기는 아무것도 확실하지 않아',
  '아무도 정하지 않았어',
  '그냥 지나쳤는지도 몰라',
];

/** Completes "나는 계속 ...". */
const CONTINUE = ['문을 봐', '같은 말을 해', '신호를 기다려', '시간을 세어', '결말을 고쳐 써'];

/** Standalone agency lines: the turn from doubt to a decision. */
const AGENCY_LINES = [
  '그래서 나는 운전대를 잡아',
  '이번엔 내가 먼저 말해',
  '그만 기다리기로 했어',
  '값을 치르기로 했어',
  '깨끗하게 나가기로 했어',
];

/** Completes "나 이제 ...". */
const PLANS = ['안 속이기로 했어', '그냥 해보기로 했어', '더 바라기로 했어'];

/** Completes "이번엔 ...". */
const CHOICES = ['조용히 있기로 해', '먼저 가기로 해', '말한 대로 하기로 해', '긴 길로 가기로 해'];

/** Completes "나는 ..." in the contradiction stage: "나는 X, 그래도 Y". */
const CONTRADICTION_PAIRS: Array<[string, string]> = [
  ['돌아서', '여기 남아 있어'],
  ['보내 주고', '붙잡고 있어'],
  ['조용히', '크게 말해'],
  ['앞으로 가고', '여기 있어'],
  ['버티고', '무너져'],
  ['전부 취소하고', '그래도 나타나'],
];

/** Completes "밖으로는 X, 안으로는 Y". */
const CONTRAST_PAIRS: Array<[string, string]> = [
  ['조용히', '떨려'],
  ['아주 평온하게', '무너져'],
  ['겁 없이', '망설여'],
  ['한계까지 가서', '웃고 있어'],
  ['깨어 있으면서', '꿈을 꿔'],
];

/** Bare hook leads: the subject is already clear, so no particle juggling. */
const HOOK_LEADS = ['우리는', '둘이서', '우리 둘은', '우리 모두'];

/**
 * Plain narrative present (한다체). Hook verbs in this form read as a mantra rather
 * than a command, and they agree with any subject above without conjugation choices.
 */
const HOOK_VERBS = [
  '불을 켜 둔다',
  '먼저 말한다',
  '선을 지킨다',
  '멀리 돌아간다',
  '두 번 세어 본다',
  '소리를 키운다',
  '끝까지 기다린다',
  '문을 열어 둔다',
  '우리 것이라 부른다',
];

/** Whole already-agreeing clauses: the scale expansion needs no composition. */
const WIDE_CLAUSES = [
  '온 도시가 아직 깨어 있어',
  '켜진 창마다 아직 보고 있어',
  '집으로 가는 사람들 모두',
  '같은 배를 기다리는 사람들',
];

/** Completes "우리 모두 ...". */
const WIDE_ACTIONS = ['같은 문을 잡고 있어', '같은 노래를 불러', '같은 시간을 세어', '같은 자리에 있어'];

/** Standalone closings - deliberately open. */
const UNRESOLVED = [
  '나는 아직도 모르겠어',
  '우리는 정하지 못했어',
  '그걸로 충분할지도 몰라',
  '아직 끝난 게 아니야',
  '아무도 끝이라고 말하지 않았어',
];

/** Completes "나는 ..." in the metaphor stage: "아직도 <object>". */
const METAPHOR_LINES = ['여기서 제일 큰 소리야', '아무도 가져가지 않아'];

const QUALIFIERS = ['아니면 아닐지도 몰라', '지금은 그냥', '그런 셈 치자', '오늘 밤만'];

/** Noun phrases usable as a line of their own (the object stands alone in this pack). */
const METAPHORS: Record<string, string[]> = {
  general: ['열린 채인 문', '울리지 않은 전화', '떠나간 기차의 표', '맞지 않는 열쇠', '보이지 않는 멍'],
  urban: ['금이 간 휴대폰 화면', '신발 상자에 든 현금', '블라인드 틈의 불빛', '끊어진 목걸이', '듣지 않은 음성'],
  roots: ['닫히지 않는 방충망', '식어 버린 커피', '앞유리 위의 이름', '문 앞의 개', '아무도 베지 않는 밭'],
  club: ['박자 맞추는 불빛', '바닥을 타고 오는 베이스', '꺼지지 않는 화면', '같이 부르는 사람들'],
  band: ['끊어질 듯한 줄', '켜지지 않는 성냥', '밤새 웅웅대는 앰프', '같은 마디에 걸린 테이프'],
  afro: ['뒤꿈치가 닳은 신발', '새벽에 우는 주전자', '항상 켜지는 발전기', '해가 뜰 때 끝나는 파티'],
  eastasia: ['기차에 두고 내린 우산', '아직 돌아가는 카세트', '손대지 않은 도시락', '불 하나만 켜진 승강장', '쓰다 지운 메시지'],
  latin: ['주머니 속 접힌 쪽지', '번진 손등의 헤나', '두 번 구겨진 버스 표', '아무도 앉지 않은 의자'],
  southasia: ['밤새 켜 둔 등', '문 옆에 쌓인 편지', '치수를 맞추지 못한 반지', '나 없이 떠나는 기차'],
  quiet: ['열어 둔 창문', '햇살 속에 도는 먼지', '불 꺼진 복도', '같은 배수구로 흐르는 비'],
  europe: ['끓어 넘치는 주전자', '잘못 접힌 지도', '울타리에 기대 둔 자전거', '아무도 앉지 않는 발코니'],
};


/**
 * Subject material in Korean.
 *
 * `selves` completes "나는 ...", `banks.perspective` follows `DETAILS` (readable
 * alone and after a place phrase), `uncertainty` completes "나는 계속 ...", `agency`
 * is standalone, and `conclusion` keeps `UNRESOLVED`'s shape. Any slot a subject omits
 * falls back to the general bank, so coverage can be deepened one subject at a time.
 */
const SUBJECT_MATERIAL: SubjectTable = {
  'leaving-and-staying': {
    adlib: '현관 불빛',
    selves: ['아직 여기 있어', '떠날 준비가 안 됐어', '문 앞에 서 있어'],
    banks: {
      perspective: ['같은 부엌, 다른 해', '아무도 문을 잠그지 않았어'],
      uncertainty: ['문을 봐', '같은 말을 해'],
      agency: ['이번엔 내가 먼저 말해', '멀리 돌아가기로 했어'],
      conclusion: ['우리는 정하지 못했어', '아직 끝난 게 아니야'],
    },
  },
  'city-and-work': {
    adlib: '야간 근무',
    selves: ['아직 이 도시가 낯설어', '두 개의 일을 하고 있어', '막 퇴근했어'],
    banks: {
      perspective: ['새벽 다섯 시 부엌 불', '월세는 첫날 나가', '승강장이 차오르고 있어'],
      uncertainty: ['시간을 세어', '이력서를 다시 써'],
      agency: ['일찍 나가기로 했어', '값을 치르기로 했어'],
      conclusion: ['같은 도시, 다른 일', '아무도 공평하다곤 안 했어'],
    },
  },
  'family-and-distance': {
    adlib: '부엌 식탁',
    selves: ['집에서 멀리 있어', '주말에 내려왔어', '전화를 자주 못 해'],
    banks: {
      perspective: ['부엌 라디오는 작게 켜져 있어', '아무도 앉지 않는 의자', '가장자리가 깨진 접시'],
      uncertainty: ['생일을 자꾸 잊어', '전화를 미뤄'],
      agency: ['기차로 내려가기로 했어', '말한 대로 하기로 했어'],
      conclusion: ['누군가 불을 켜 두었어', '돌아가는 길은 아직 알아'],
    },
  },
  'celebration-and-hustle': {
    adlib: '밤의 마지막 노래',
    selves: ['아직 바닥에 있어', '마지막까지 춤추고 있어', '잠이 안 와'],
    banks: {
      perspective: ['스피커가 아직 울려', '같은 노래만 세 번', '멈추지 않는 바닥'],
      uncertainty: ['오늘 수입을 세어', '내일을 걸어'],
      agency: ['소리를 키우기로 했어', '우리 거라 부르기로 했어'],
      conclusion: ['밤은 아직 안 끝났어', '우리는 여기 있어'],
    },
  },
  'memory-and-loss': {
    adlib: '빛바랜 사진',
    selves: ['아직 해를 세고 있어', '조용한 쪽에 있어', '같은 자리에 있어'],
    banks: {
      perspective: ['문 옆에 쌓인 편지', '연기 냄새가 남은 코트', '조용해진 마당'],
      uncertainty: ['지난 메시지를 읽어', '옛 번호를 지워'],
      agency: ['소리 내어 말하기로 했어', '그만 기다리기로 했어'],
      conclusion: ['그걸로 충분할지도 몰라', '어딘가에는 아직 자정'],
    },
  },
  'starting-over': {
    adlib: '맞지 않는 열쇠',
    selves: ['거의 떠날 준비가 됐어', '여기 온 지 얼마 안 됐어', '이미 절반쯤 떠났어'],
    banks: {
      perspective: ['문 옆에 놓인 가방', '잘못 접힌 지도', '다른 도시의 첫 아침'],
      uncertainty: ['지도를 다시 봐', '새 거리를 익혀'],
      agency: ['전부 취소하기로 했어', '깨끗하게 나가기로 했어'],
      conclusion: ['여기서 끝나는 게 아니야', '내일도 시작이야'],
    },
  },
};

/** Subject-aware bank lookup; any stage a subject omits uses the general bank. */
const bank = bankPicker(SUBJECT_MATERIAL);

/**
 * Whole-line primitives for styles that place lines themselves (see `primitives.ts`).
 *
 * Complete lines, not fragments: a writing agent decides the order, so a question has to
 * read as a question wherever it lands. Plain 해체 forms throughout, matching the rest of
 * the pack, and no particle depends on what precedes it.
 */
const PRIMITIVE_BANKS: Partial<Record<PrimitiveId, string[]>> = {
  question: [
    '왜 나를 두고 갔어',
    '너는 어디로 갔어',
    '이제 나는 뭘 해야 해',
    '언제까지 기다려야 해',
    '누가 나를 구해 줄까',
    '우리는 언제 남이 됐어',
    '누가 진실을 말해 줄까',
  ],
  answer: [
    '나는 머물 수 없었어',
    '아무도, 아무도 안 왔어',
    '나도 잘 몰라, 그게 다야',
    '내 일이 아니었어',
    '누군가는 해야 했어',
    '이미 반쯤 떠났어',
  ],
  // A stated position the song then tests: promise, confession, belief.
  claim: [
    '전화하지 않겠다고 했어',
    '나는 괜찮다고 말했어',
    '시간이 다 낫게 한다고들 해',
    '다시는 안 간다고 했어',
    '이제 끝났다고 말했어',
  ],
  reversal: [
    '그런데도 번호를 눌렀어',
    '그래도 문을 봐',
    '그럼 왜 아직 기억해',
    '이미 반쯤 돌아갔어',
    '사실 한 번도 떠나지 않았어',
  ],
  implication: [
    '누군가 기다림을 그만뒀어',
    '이게 떠나는 모습이야',
    '그 조용함이 그런 거였어',
    '그 불빛은 내 것이 아니야',
    '이렇게 끝나는 거야',
  ],
  universal: [
    '누구나 뭔가를 두고 가',
    '아무도 그해를 갖지 못해',
    '우리는 다 같은 방식으로 배워',
    '어떤 건 나중에야 끝난 걸 알아',
    '붙잡은 채로 떠날 수는 없어',
  ],
  // Ordered escalation: the array *is* the escalation; order must not be shuffled.
  ladder: [
    '열쇠를 또 잃어버렸어',
    '막차를 놓쳤어',
    '면접에 못 갔어',
    '삼월에 일자리를 잃었어',
    '월세를 낼 수가 없어',
  ],
  deadline: [
    '돈이 떨어지기까지 사흘',
    '기차가 떠나기 전 하룻밤',
    '주말까지 만 원',
    '문을 닫기까지 두 시간',
    '재판까지 일주일',
  ],
  fragment: ['그냥 비야', '아무것도 없어', '그냥 침묵', '아무도 없어', '그것뿐이야'],
};

export const koreanPack: LanguagePack = {
  code: 'ko',
  label: 'Korean',
  nativeLabel: '한국어',
  script: 'hangul',
  complete: true,
  subjectCoverage: subjectIdsOf(SUBJECT_MATERIAL),
  primitives: PRIMITIVE_BANKS,

  buildHook: (rng) => `${fromBank(rng, HOOK_LEADS)} ${fromBank(rng, HOOK_VERBS)}`,
  // A whole clause: Korean needs no copula here, so there is no agreed verb to add.
  buildScale: (rng) => ({ subject: fromBank(rng, WIDE_CLAUSES), verb: '' }),

  pickContradiction: (rng) => pairFromBank(rng, CONTRADICTION_PAIRS, new Set()),
  pickContrast: (rng) => pairFromBank(rng, CONTRAST_PAIRS, new Set()),
  pickQualifier: (rng) => fromBank(rng, QUALIFIERS),

  // A Hangul chart word can stand as an ad-lib; otherwise the subject's own fragment.
  introLine: (ctx) => `(${ctx.topicWord ?? subjectAdlib(SUBJECT_MATERIAL, ctx) ?? ctx.hook})`,
  /**
   * Reframing is this pack's grammar decision, and so is knowing when the words will not fit:
   * hook plus qualifier ran to fifteen blocks, past the comfortable band. When the combined
   * line is too long the qualifier carries the reframe alone - it still turns the hook against
   * itself, without asking for a line that cannot be sung at tempo.
   */
  reframe: boundedReframe('hangul'),

  metaphors: (family) => [...(METAPHORS[family] ?? []), ...METAPHORS.general.slice(0, 2)],

  render: {
    perspective: (count, ctx, used) => {
      const time = fromBank(ctx.rng, TIMES, used);
      const place = fromBank(ctx.rng, PLACES, used);
      const self = fromBank(ctx.rng, subjectSelves(SUBJECT_MATERIAL, ctx) ?? SELVES, used);
      const detail = fromBank(ctx.rng, bank(ctx, 'perspective', DETAILS), used);
      // One idea per line rather than "time + place" glued together: Korean phrases are long
      // enough that a combined line lands outside the singable band, which the gate caught as
      // soon as styles began repeating those lines instead of using each one once.
      return takeLines(
        [
          `지금은 ${time}`,
          sentenceCase(place),
          `나는 ${self}`,
          sentenceCase(detail),
        ],
        count,
      );
    },

    uncertainty: (count, ctx, used) =>
      takeLines(
        [
          fromBank(ctx.rng, UNCERTAIN_CLAUSES, used),
          `나는 계속 ${fromBank(ctx.rng, bank(ctx, 'uncertainty', CONTINUE), used)}`,
        ],
        count,
      ),

    agency: (count, ctx, used) =>
      takeLines(
        [
          fromBank(ctx.rng, bank(ctx, 'agency', AGENCY_LINES), used),
          `나 이제 ${fromBank(ctx.rng, PLANS, used)}`,
          `이번엔 ${fromBank(ctx.rng, CHOICES, used)}`,
        ],
        count,
      ),

    contradiction: (count, ctx) => {
      const [a, b] = ctx.contradiction;
      const [x, y] = ctx.contrast;
      return takeLines(
        [
          ctx.hook,
          `나는 ${a}, 그래도 ${b}`,
          `밖으로는 ${x}, 안으로는 ${y}`,
          `나는 ${a}, 그리고도 ${b}`,
        ],
        count,
      );
    },

    metaphor: (count, ctx) =>
      // The object stands alone: prefixing it ("아직도 ...") pushed the longer bank entries past
      // the singable band, and a bare noun phrase already reads as a lyric line in Korean.
      takeLines([ctx.metaphor, sentenceCase(fromBank(ctx.rng, METAPHOR_LINES))], count),

    scale: (count, ctx, used) =>
      takeLines(
        [
          '나만 그런 게 아니야',
          sentenceCase(ctx.wideSubject),
          `우리 모두 ${fromBank(ctx.rng, WIDE_ACTIONS, used)}`,
        ],
        count,
      ),

    conclusion: (count, ctx, used) => {
      if (ctx.conclusion === 'reframed') {
        return Array.from({ length: Math.min(count, 2) }, () =>
          `(${koreanPack.reframe(ctx.hook, ctx.qualifier)})`,
        );
      }
      return takeLines(
        [
          fromBank(ctx.rng, bank(ctx, 'conclusion', UNRESOLVED), used),
          // No particle or copula: the time noun stands alone and cannot misagree.
          `어딘가에는 아직 ${fromBank(ctx.rng, TIMES, used)}`,
        ],
        count,
      );
    },
  },
};
