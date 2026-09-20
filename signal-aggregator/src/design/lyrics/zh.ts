/**
 * Mandarin Chinese pack (Han).
 *
 * Grammar decisions:
 *
 *  - **No inflection at all**: no plural, no gender, no verb agreement, no tense
 *    marking, so the traps that shape the European packs (elision, gender agreement,
 *    verb-final order) do not exist here. What replaces them is word order and
 *    measure words, which is why the banks are written as whole phrases;
 *  - **lines are composed by concatenation only where Chinese allows it**: the
 *    templates add no particle that depends on the preceding syllable, and noun
 *    phrases are never placed where a measure word or 的/了 would be required;
 *  - **one syllable per Han character** (the validator's model), so lines are written
 *    to 6-11 characters to stay inside the comfortable band at typical tempos;
 *  - **rhyme is treated as approximate on purpose**: real Mandarin rhyme is a
 *    rime-plus-tone system that orthography alone cannot express, and the validator's
 *    `han` rhyme score is labelled as an approximation for exactly that reason.
 *
 * The four cliches the validator already flags for `zh` are avoided deliberately:
 * "金子般的心", "在雨中跳舞", "让我自由", "打破枷锁".
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
import type { PrimitiveId } from './primitives.js';

/** Bare time nouns: no copula, so nothing can misagree. */
const TIMES = ['午夜', '天亮之前', '黄昏时候', '末班车时间', '又一个周日', '收摊的时候'];

/** Complete locative phrases: the position word is already attached. */
const PLACES = ['这条街上', '东边那头', '死路尽头', '末班车里', '租来的房间', '场地后面'];

/** Completes "我...". No gender or number marking is needed. */
const SELVES = ['我还在这里', '对这个城市还很陌生', '在两个告别之间', '还站在原处', '在安静这一边'];

/** Standalone lines, also readable after a place ("这条街上，..."). */
const DETAILS = [
  '同样的厨房，换了一年',
  '这里什么都没动',
  '招牌还亮着',
  '没人把门锁上',
  '电台还是那几首',
];

/** Standalone uncertainty lines. */
const UNCERTAIN = [
  '我还是不知道',
  '也许我们早就错了',
  '这里没有什么确定',
  '没人做出决定',
  '也许只是路过',
];

/** Completes "我还在...". */
const CONTINUE = ['看着那扇门', '重复那几句话', '等一个信号', '数着钟点', '改着结尾'];

/** Standalone agency lines: the turn from doubt to a decision. */
const AGENCY = [
  '所以我握住方向盘',
  '这一次我先开口',
  '我不想再等了',
  '我付了这笔账',
  '我干干净净地走',
];

/** Completes "我打算...". */
const PLANS = ['不再假装', '吃亏也要学', '照样去做', '多要一点'];

/** Completes "这一次我...". */
const CHOICES = ['选择安静', '先走一步', '说到做到', '走远路'];

/** Completes "我...，可我还是...". */
const CONTRADICTION_PAIRS: Array<[string, string]> = [
  ['放手', '抓得更紧'],
  ['转身走开', '留了一夜'],
  ['不出声', '说得更响'],
  ['咬紧牙', '让它滑走'],
  ['撑住不哭', '彻底散开'],
  ['继续往前', '留在原地'],
  ['全部取消', '照样出现'],
];

/** Completes "我表面...，心里...". */
const CONTRAST_PAIRS: Array<[string, string]> = [
  ['很平静', '在发抖'],
  ['站得很稳', '在散开'],
  ['不怕', '在犹豫'],
  ['到了极限', '还在笑'],
  ['醒着', '在做梦'],
];

/** Bare hook leads: Chinese needs no particle after these. */
const HOOK_LEADS = ['我们', '你我', '我们两个', '所有人'];

/** Hook verbs, written to read as a mantra rather than an order. */
const HOOK_VERBS = [
  '留着那盏灯',
  '先说出口',
  '守住这条线',
  '绕远路回家',
  '再数一遍',
  '把声音开大',
  '等到天亮',
  '把门开着',
  '说成我们的',
];

/** Whole already-agreeing clauses: the scale expansion needs no composition. */
const WIDE_CLAUSES = ['整座城市还醒着', '每一扇亮着的窗都还在看', '所有还没回家的人', '等同一班车的人'];

/** Completes "我们都在...". */
const WIDE_ACTIONS = ['等同一班车', '学同一首歌', '数着同样的钟点', '扶着同一扇门'];

/** Standalone closings - deliberately open. */
const UNRESOLVED = ['我们从来没决定', '也许这样就够了', '这还没有结束', '没人说过结束', '也许要再等一等'];

/** Completes "还有，<object>": the two lines that answer the image. */
const METAPHOR_LINES = ['它还是这里最响的东西', '没有人把它拿走'];

const QUALIFIERS = ['也许不是', '就现在这样', '或者差不多', '只是今晚'];

/** Noun phrases usable after "还有，" (there is still ...), in Chinese. */
const METAPHORS: Record<string, string[]> = {
  general: ['一扇开着的门', '一部从没响过的电话', '一张错过班车的票', '一把配不上的钥匙', '一块看不见的淤青'],
  urban: ['碎了的手机屏幕', '鞋盒里的现金', '百叶窗外的路灯', '断了的项链', '没听过的那条语音'],
  roots: ['关不上的纱门', '加油站凉掉的咖啡', '仪表盘灰尘上的名字', '门口等着的那条狗', '没人割过的田'],
  club: ['踩着拍子的闪光灯', '从地板升上来的低音', '一直不黑的屏幕', '跟着一起唱的人群'],
  band: ['快要断的琴弦', '点不着的火柴', '整夜嗡嗡响的功放', '卡在同一小节的磁带'],
  afro: ['鞋跟磨薄了的鞋', '天刚亮就响的水壶', '总能发动的发电机', '到日出才散的聚会'],
  eastasia: ['落在车上的伞', '还在转的卡带', '没动过的便当', '只亮一盏灯的站台', '打了又删的消息'],
  latin: ['口袋里折起的字条', '手背上褪色的花纹', '皱了两次的车票', '没人坐的那把椅子'],
  southasia: ['亮了一夜的灯', '门口堆着的信', '一直没改尺寸的戒指', '不等我就开的火车'],
  quiet: ['开着的窗', '光里浮着的灰', '熄了灯的长廊', '流进同一个下水口的雨'],
  europe: ['一直烧着的水壶', '折错方向的地图', '靠在栅栏上的自行车', '没人坐的阳台'],
};

/**
 * Subject material in Chinese.
 *
 * `selves` completes "我...", `banks.perspective` follows `DETAILS` (readable alone
 * and after a place phrase), `uncertainty` completes "我还在...", `agency` is
 * standalone, and `conclusion` keeps `UNRESOLVED`'s shape. Any slot a subject omits
 * falls back to the general bank, so coverage can be deepened one subject at a time.
 */
const SUBJECT_MATERIAL: SubjectTable = {
  'leaving-and-staying': {
    adlib: '门口那盏灯',
    selves: ['我还在这里', '还没学会离开', '还站在门边'],
    banks: {
      perspective: ['同样的厨房，换了一年', '没人把门锁上'],
      uncertainty: ['看着那扇门', '重复那几句话'],
      agency: ['这一次我先开口', '绕远路回家'],
      conclusion: ['我们从来没决定', '这还没有结束'],
    },
  },
  'city-and-work': {
    adlib: '夜班',
    selves: ['对这个城市还很陌生', '我在打两份工', '刚下夜班'],
    banks: {
      perspective: ['清晨五点厨房的灯', '一号就要交房租', '站台越来越挤'],
      uncertainty: ['数着还剩多少', '重写那份简历'],
      agency: ['先上早班', '我付了这笔账'],
      conclusion: ['同样的城市，换份工作', '没人说过会公平'],
    },
  },
  'family-and-distance': {
    adlib: '厨房那张桌子',
    selves: ['我离家很远', '这周末回了家', '常常忘了打电话'],
    banks: {
      perspective: ['厨房的收音机开得很小', '一把没人坐的椅子', '边缘缺口的碗'],
      uncertainty: ['总忘生日', '把电话拖着'],
      agency: ['坐火车回家', '说到做到'],
      conclusion: ['有人把那盏灯留着', '回去的路我还认得'],
    },
  },
  'celebration-and-hustle': {
    adlib: '今晚最后一首',
    selves: ['我还站在场里', '跳到最后一首', '一点也不困'],
    banks: {
      perspective: ['音箱还在响', '同样三首又一遍', '地板停不下来'],
      uncertainty: ['数着今天的收入', '把明天押上'],
      agency: ['把声音开大', '说成我们的'],
      conclusion: ['这一夜还没完', '我们还在这里'],
    },
  },
  'memory-and-loss': {
    adlib: '一张褪色的照片',
    selves: ['还在数着年份', '在安静这一边', '还站在原处'],
    banks: {
      perspective: ['门口堆着的信', '还有烟味的外套', '安静下来的院子'],
      uncertainty: ['读着旧消息', '留着旧号码'],
      agency: ['大声说出来', '我不想再等了'],
      conclusion: ['也许这样就够了', '某个地方还亮着'],
    },
  },
  'starting-over': {
    adlib: '一把不再合适的钥匙',
    selves: ['差不多要走了', '我刚到这里', '已经走了一半'],
    banks: {
      perspective: ['门口放着的箱子', '折错方向的地图', '别处的第一个清晨'],
      uncertainty: ['再看一次地图', '记新的街道'],
      agency: ['全部取消', '我干干净净地走'],
      conclusion: ['这里不是终点', '明天也算开始'],
    },
  },
};

/** Subject-aware bank lookup; any stage a subject omits uses the general bank. */
const bank = bankPicker(SUBJECT_MATERIAL);

/**
 * Whole-line primitives for styles that place lines themselves (see `primitives.ts`).
 *
 * Complete lines, not fragments: a writing agent decides the order, so a question has to
 * read as a question wherever it lands. No measure word or particle here depends on what
 * precedes the line.
 */
const PRIMITIVE_BANKS: Partial<Record<PrimitiveId, string[]>> = {
  question: [
    '你为什么离开这里',
    '你现在要去哪里',
    '现在我该做什么',
    '要我等到什么时候',
    '谁能告诉我真相',
    '我们什么时候变的',
  ],
  answer: [
    '因为我留不下来',
    '没有人来，一直没有',
    '我也不知道，这是真话',
    '从来都不是我的事',
    '总得有人去做',
    '我早就走了一半',
  ],
};

export const chinesePack: LanguagePack = {
  code: 'zh',
  label: 'Mandarin Chinese',
  nativeLabel: '中文',
  script: 'han',
  complete: true,
  subjectCoverage: subjectIdsOf(SUBJECT_MATERIAL),
  primitives: PRIMITIVE_BANKS,

  buildHook: (rng) => `${fromBank(rng, HOOK_LEADS)}${fromBank(rng, HOOK_VERBS)}`,
  // A whole clause: Chinese has no copula to agree here.
  buildScale: (rng) => ({ subject: fromBank(rng, WIDE_CLAUSES), verb: '' }),

  pickContradiction: (rng) => pairFromBank(rng, CONTRADICTION_PAIRS, new Set()),
  pickContrast: (rng) => pairFromBank(rng, CONTRAST_PAIRS, new Set()),
  pickQualifier: (rng) => fromBank(rng, QUALIFIERS),

  // A Han chart word can stand as an ad-lib; otherwise the subject's own fragment.
  introLine: (ctx) => `(${ctx.topicWord ?? subjectAdlib(SUBJECT_MATERIAL, ctx) ?? ctx.hook})`,
  reframe: (hook, qualifier) => `${hook}，${qualifier}`,

  metaphors: (family) => [...(METAPHORS[family] ?? []), ...METAPHORS.general.slice(0, 2)],

  render: {
    perspective: (count, ctx, used) => {
      const time = fromBank(ctx.rng, TIMES, used);
      const place = fromBank(ctx.rng, PLACES, used);
      const self = fromBank(ctx.rng, subjectSelves(SUBJECT_MATERIAL, ctx) ?? SELVES, used);
      const detail = fromBank(ctx.rng, bank(ctx, 'perspective', DETAILS), used);
      return takeLines(
        [
          `现在是${time}，${place}`,
          `我${self}`,
          sentenceCase(detail),
          `${sentenceCase(place)}，${detail}`,
        ],
        count,
      );
    },

    uncertainty: (count, ctx, used) =>
      takeLines(
        [
          fromBank(ctx.rng, UNCERTAIN, used),
          `我还在${fromBank(ctx.rng, bank(ctx, 'uncertainty', CONTINUE), used)}`,
        ],
        count,
      ),

    agency: (count, ctx, used) =>
      takeLines(
        [
          fromBank(ctx.rng, bank(ctx, 'agency', AGENCY), used),
          `我打算${fromBank(ctx.rng, PLANS, used)}`,
          `这一次我${fromBank(ctx.rng, CHOICES, used)}`,
        ],
        count,
      ),

    contradiction: (count, ctx) => {
      const [a, b] = ctx.contradiction;
      const [x, y] = ctx.contrast;
      return takeLines(
        [
          ctx.hook,
          `我${a}，可我还是${b}`,
          `我表面${x}，心里${y}`,
          `我${a}，也还是${b}`,
        ],
        count,
      );
    },

    metaphor: (count, ctx) =>
      takeLines([`还有，${ctx.metaphor}`, sentenceCase(fromBank(ctx.rng, METAPHOR_LINES))], count),

    scale: (count, ctx, used) =>
      takeLines(
        [
          '不只是我一个人',
          sentenceCase(ctx.wideSubject),
          `我们都在${fromBank(ctx.rng, WIDE_ACTIONS, used)}`,
        ],
        count,
      ),

    conclusion: (count, ctx, used) => {
      if (ctx.conclusion === 'reframed') {
        return Array.from({ length: Math.min(count, 2) }, () =>
          `(${chinesePack.reframe(ctx.hook, ctx.qualifier)})`,
        );
      }
      return takeLines(
        [
          fromBank(ctx.rng, bank(ctx, 'conclusion', UNRESOLVED), used),
          `某个地方还是${fromBank(ctx.rng, TIMES, used)}`,
        ],
        count,
      );
    },
  },
};

