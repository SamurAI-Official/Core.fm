/**
 * Writing-style gate.
 *
 * `lyric-pack-acceptance.ts` proves a pack writes its own language and `subject-spread.ts`
 * proves the writer is not subject-bound. This proves the *writing styles* are real:
 *
 *   1. every registered style renders, inside the same bars as everything else (no language
 *      fallback, right script, meter fit, no borrowed cliches);
 *   2. the engine a style claims is actually in the output - asserted per style below, because
 *      a style whose engine cannot be observed is a label rather than a style, and the gate
 *      fails any registered style that has no assertions;
 *   3. repetition is handled per style: a fault where the style says `fault`, the device where
 *      it says `device` (and a device style must really repeat something);
 *   4. a style whose primitives a pack lacks is never *chosen* for it, and if it is forced
 *      anyway it says so (`agentRealised: false`) and still validates instead of crashing;
 *   5. a market's designs vary in structure, not only in words, across seeds.
 *
 *   npx tsx scripts/agent-spread.ts            # checks + summary
 *   npx tsx scripts/agent-spread.ts --print    # plus one sample song per style
 */
import { validateLyricPlan, writeLyrics, type LyricPlan } from '../src/design/lyrics.js';
import { AGENTS, listAgents } from '../src/design/agents/registry.js';
import { resolvePack } from '../src/design/lyrics/index.js';
import { coversPrimitives, primitiveBank, type PrimitiveId } from '../src/design/lyrics/primitives.js';
import { plainText, sectionMap } from '../src/design/lyrics/validate.js';

const MIN_SCORE = 0.6;
const MIN_METER_FIT = 0.5;
const MIN_SCRIPT_CONSISTENCY = 0.9;

/**
 * Repetition ceilings.
 *
 * The *floors* belong to the styles - `hook-variation-payoff` must sing its claim 4+ times, a
 * refrain 3+ - and a floor alone lets a device style drift until one line is half the song. The
 * first 120 designs averaged 63% duplicated lines in `hook-variation-payoff` with one line sung
 * 9x out of 16, where the style's own contract asks for 4. These are ceilings on the *whole*
 * song (`maxLineShare` / `distinctLineShare`), not on one section, because a hook spread across
 * seven sections is invisible to a per-section count - which is exactly how that drift went
 * unnoticed.
 *
 * `maxLineShare` is the sharp one: a line that is half a song is a tic, and the measurement
 * separates the styles that had drifted (50-56%) from every style that had not (23-29%).
 *
 * `distinctLineShare` is the blunter one, because a repeated chorus is a legitimate cost - a
 * 3-line chorus sung twice spends a fifth of a short song on itself, and that is songwriting,
 * not a defect. So the bar sits *below* the range legitimate styles occupy (fault styles measure
 * 50-58% distinct today) rather than at it, and its job is to catch a collapse into a loop
 * rather than to score taste: the five styles that drifted were down at 37-47%.
 */
const MAX_DEVICE_LINE_SHARE = 0.4;
const MIN_DEVICE_DISTINCT_SHARE = 0.5;
const MAX_FAULT_LINE_SHARE = 0.35;
const MIN_FAULT_DISTINCT_SHARE = 0.45;

const SEEDS = [1, 2, 3, 4];
const PRINT = process.argv.includes('--print');

const CASES = [
  { market: 'us', genre: 'country', language: 'en' },
  { market: 'gb', genre: 'pop', language: 'en' },
  { market: 'fr', genre: 'pop', language: 'fr' },
  { market: 'de', genre: 'singer_songwriter', language: 'de' },
  { market: 'es', genre: 'reggaeton', language: 'es' },
  { market: 'it', genre: 'pop', language: 'it' },
  { market: 'br', genre: 'pop', language: 'pt' },
  { market: 'ru', genre: 'pop', language: 'ru' },
  { market: 'kr', genre: 'k_pop', language: 'ko' },
  { market: 'cn', genre: 'regional_east_asia', language: 'zh' },
];

let failures = 0;
function fail(message: string): void {
  failures += 1;
  console.log(`  FAIL  ${message}`);
}

function render(testCase: (typeof CASES)[number], seed: number, agent?: string): LyricPlan {
  return writeLyrics({
    themes: ['late-night city life', 'connection', 'celebration'],
    terms: ['midnight', 'harbour', 'holding on'],
    energy: 0.6,
    language: testCase.language,
    genre: testCase.genre,
    seed,
    ...(agent ? { agent } : {}),
  });
}

const sungLines = (plan: LyricPlan): string[] => plainText(plan.lyrics).split('\n').filter(Boolean);
const sungSections = (plan: LyricPlan) => sectionMap(plan.lyrics);
const timesSung = (plan: LyricPlan, line: string): number =>
  sungLines(plan).filter((entry) => entry === line).length;

/** Every line the given primitive banks hold, for "did this come from the pack" checks. */
function bankLines(pack: ReturnType<typeof resolvePack>['pack'], ids: PrimitiveId[]): Set<string> {
  return new Set(ids.flatMap((id) => primitiveBank(pack, id)));
}

/** The shared bars every style has to clear, whatever it is doing structurally. */
function checkQuality(
  label: string,
  plan: LyricPlan,
  language: string,
  expectedRealised: boolean,
): ReturnType<typeof validateLyricPlan> {
  const validation = validateLyricPlan(plan, { bpm: 100, timeSignature: '4/4' });
  if (plan.languageFallback) fail(`${label}: fell back to ${plan.language}`);
  if (plan.language !== language) fail(`${label}: wrote '${plan.language}', expected '${language}'`);
  if (validation.scriptConsistency < MIN_SCRIPT_CONSISTENCY) {
    fail(`${label}: script consistency ${validation.scriptConsistency}`);
  }
  if (validation.cliches.length > 0) fail(`${label}: cliches ${validation.cliches.join(', ')}`);
  if (validation.meterFit < MIN_METER_FIT) {
    // Name the offending lines: the style is usually fine and a bank entry is too long or too
    // short, and "meterFit 0.467" alone sends the reader hunting through the pack.
    const low = validation.targetSyllables * 0.5;
    const high = validation.targetSyllables * 1.5;
    const offenders = validation.lines
      .filter((metric) => metric.syllables < low || metric.syllables > high)
      .slice(0, 3)
      .map((metric) => `${metric.syllables}s "${metric.line}"`);
    fail(`${label}: meterFit ${validation.meterFit} (target ${validation.targetSyllables}) - ${offenders.join(' | ')}`);
  }
  if (validation.score < MIN_SCORE) fail(`${label}: score ${validation.score}`);

  // Repetition across the whole song, which is where a hook swallows a lyric. Section-level
  // repetition is already policed by `repetition` above and by each style's own engine checks;
  // this is the ceiling those two cannot see.
  const device = plan.repetitionPolicy === 'device';
  const maxShare = device ? MAX_DEVICE_LINE_SHARE : MAX_FAULT_LINE_SHARE;
  const minDistinct = device ? MIN_DEVICE_DISTINCT_SHARE : MIN_FAULT_DISTINCT_SHARE;
  if (validation.maxLineShare > maxShare) {
    fail(
      `${label}: one line is ${(validation.maxLineShare * 100).toFixed(0)}% of the song ` +
        `(${validation.maxLineRepeats}x, ceiling ${(maxShare * 100).toFixed(0)}%): "${validation.mostSungLine}"`,
    );
  }
  if (validation.distinctLineShare < minDistinct) {
    fail(
      `${label}: only ${(validation.distinctLineShare * 100).toFixed(0)}% of the lines are distinct ` +
        `(floor ${(minDistinct * 100).toFixed(0)}%)`,
    );
  }
  if (plan.agentRealised !== expectedRealised) {
    fail(`${label}: agentRealised ${plan.agentRealised}, expected ${expectedRealised}`);
  }
  return validation;
}

/**
 * What each style claims about its own output, checked against that output.
 *
 * One block per style; the gate fails a registered style that has none, because a style whose
 * engine cannot be observed in its lyrics is a name rather than a style. The checks are
 * structural wherever structure is the claim - a refrain is byte-identical, an escalation is
 * ordered, a circular song opens and closes on the same line - and never assert taste.
 */
const ENGINE_CHECKS: Record<string, (label: string, plan: LyricPlan, language: string) => void> = {
  arc: (label, plan) => {
    if (!plan.arc) fail(`${label}: arc style produced no arc report`);
    if (plan.repetitionPolicy !== 'fault') fail(`${label}: arc should treat repetition as a fault`);
    if (plan.structure.length < 5) fail(`${label}: arc produced ${plan.structure.length} sections`);
  },

  'refrain-mutation': (label, plan) => {
    const restatements = timesSung(plan, plan.hook);
    if (restatements < 3) fail(`${label}: refrain sung ${restatements}x, expected at least 3`);
    if (plan.repetitionPolicy !== 'device') fail(`${label}: refrain style must mark repetition a device`);
    const choruses = sungSections(plan).filter((section) => section.name === 'Chorus');
    if (choruses.length >= 2 && choruses[0].lines.join('|') !== choruses[1].lines.join('|')) {
      fail(`${label}: the repeated chorus is not byte-identical`);
    }
  },

  'question-answer': (label, plan, language) => {
    const questions = (plan.agentReport.questions as string[] | undefined) ?? [];
    const lengths = (plan.agentReport.questionLengths as number[] | undefined) ?? [];
    const answers = (plan.agentReport.answers as string[] | undefined) ?? [];
    const questionsAvailable = (plan.agentReport.questionsAvailable as number | undefined) ?? questions.length;
    const answersAvailable = (plan.agentReport.answersAvailable as number | undefined) ?? answers.length;
    if (questions.length < 2) fail(`${label}: expected at least 2 questions, got ${questions.length}`);
    if (questions.length <= questionsAvailable && new Set(questions).size !== questions.length) {
      fail(`${label}: questions repeat within one song`);
    }
    if (questions.length > 1 && questions[0] === questions[questions.length - 1]) {
      fail(`${label}: the closing question is the same as the opening one`);
    }
    for (let index = 1; index < lengths.length; index += 1) {
      if (lengths[index] < lengths[index - 1]) {
        fail(`${label}: question lengths do not rise (${lengths.join(' -> ')})`);
        break;
      }
    }
    if (answers.length <= answersAvailable && new Set(answers).size !== answers.length) {
      fail(`${label}: answers repeat within one song`);
    }
    const bank = bankLines(resolvePack(language).pack, ['question']);
    if (bank.size > 0) {
      const borrowed = questions.filter((question) => !bank.has(question));
      if (borrowed.length > 0) fail(`${label}: question not from the pack's bank: ${borrowed[0]}`);
    }
  },

  'slogan-story': (label, plan) => {
    if (timesSung(plan, plan.hook) < 3) fail(`${label}: thesis sung ${timesSung(plan, plan.hook)}x, expected 3+`);
    if (plan.repetitionPolicy !== 'device') fail(`${label}: a returning slogan is a device`);
    const statements = (plan.agentReport.statements as number | undefined) ?? 0;
    if (statements < 3) fail(`${label}: thesis stated in only ${statements} sections`);
    // The bridge has to turn the thesis, or there is no counter-example at all.
    const bridge = sungSections(plan).find((section) => section.name === 'Bridge');
    if (bridge && bridge.lines.every((line) => line === plan.hook)) {
      fail(`${label}: the bridge never turns the thesis against itself`);
    }
  },

  'object-symbol': (label, plan) => {
    const object = (plan.agentReport.object as string | undefined) ?? '';
    const appearances = timesSung(plan, object);
    if (appearances < 3) fail(`${label}: the object appears ${appearances}x, expected 3+`);
    // The object only becomes a symbol if the context around it keeps changing.
    const sections = sungSections(plan).filter((section) => section.lines.includes(object));
    const contexts = new Set(sections.flatMap((section) => section.lines.filter((line) => line !== object)));
    if (contexts.size < 3) fail(`${label}: only ${contexts.size} distinct context line(s) around the object`);
  },

  'one-line-premise': (label, plan) => {
    const premise = (plan.agentReport.premise as string | undefined) ?? '';
    if (!premise) fail(`${label}: no premise reported`);
    if (timesSung(plan, premise) < 2) fail(`${label}: the premise is sung ${timesSung(plan, premise)}x, expected 2+`);
    const all = sungLines(plan);
    if (all[all.length - 1] !== premise) fail(`${label}: the song does not close on the premise`);
  },

  circular: (label, plan) => {
    const sections = sungSections(plan);
    const opening = sections[0]?.lines[0];
    const closing = sections[sections.length - 1]?.lines[0];
    if (!opening || opening !== closing) {
      fail(`${label}: the song does not return to its opening line ("${opening}" vs "${closing}")`);
    }
    if (plan.repetitionPolicy !== 'device') fail(`${label}: a circular return is a device`);
  },

  'missing-character': (label, plan, language) => {
    const withheld = (plan.agentReport.withheld as string | undefined) ?? '';
    if (!withheld) fail(`${label}: nothing reported as withheld`);
    // The point is that nothing is explained: no line may come from an explicit-statement bank,
    // even though the style is allowed to run on a pack that has them.
    const explicit = bankLines(resolvePack(language).pack, ['claim', 'universal']);
    if (explicit.size > 0) {
      const stated = sungLines(plan).filter((line) => explicit.has(line));
      if (stated.length > 0) fail(`${label}: a line states the cause outright: ${stated[0]}`);
    }
  },

  'groove-return': (label, plan) => {
    if (timesSung(plan, plan.hook) < 4) {
      fail(`${label}: the pattern appears ${timesSung(plan, plan.hook)}x, expected 4+`);
    }
    if (plan.repetitionPolicy !== 'device') fail(`${label}: a returned pattern is a device`);
    const sections = sungSections(plan);
    const breakIndex = sections.findIndex((section) => section.name === 'Bridge');
    if (breakIndex < 0) fail(`${label}: no break section`);
    if (breakIndex >= 0 && sections[breakIndex].lines.length !== 1) {
      fail(`${label}: the break is ${sections[breakIndex].lines.length} lines, expected 1`);
    }
    const before = sections.find((section) => section.name === 'Chorus')?.lines.join('|');
    const after = sections.filter((section) => section.name === 'Chorus').slice(-1)[0]?.lines.join('|');
    if (before && after && before !== after) fail(`${label}: the pattern does not return unchanged`);
  },

  'hook-variation-payoff': (label, plan, language) => {
    if (timesSung(plan, plan.hook) < 4) fail(`${label}: claim sung ${timesSung(plan, plan.hook)}x, expected 4+`);
    if (plan.repetitionPolicy !== 'device') fail(`${label}: a returned hook is a device`);
    const variation = (plan.agentReport.reinterpretation as string | undefined) ?? '';
    if (!variation) fail(`${label}: no reinterpretation reported`);
    if (timesSung(plan, variation) < 1) fail(`${label}: the reinterpretation is never sung`);
    // The variation has to be one of the pack's own implication lines, not an invention.
    const bank = bankLines(resolvePack(language).pack, ['implication']);
    if (bank.size > 0 && !bank.has(variation)) fail(`${label}: reinterpretation not from the pack's bank: ${variation}`);
  },

  'false-resolution': (label, plan) => {
    const resolution = (plan.agentReport.resolution as string | undefined) ?? '';
    const destabiliser = (plan.agentReport.destabiliser as string | undefined) ?? '';
    if (!resolution || !destabiliser) fail(`${label}: resolution or destabiliser missing from the report`);
    if (resolution === destabiliser) fail(`${label}: the destabiliser is the resolution`);
    const sections = sungSections(plan);
    const resolutionAt = sections.findIndex((section) => section.lines.includes(resolution));
    const destabiliserAt = sections.findIndex((section) => section.lines.includes(destabiliser));
    if (resolutionAt < 0) fail(`${label}: the apparent resolution is never sung`);
    if (destabiliserAt >= 0 && resolutionAt >= 0 && destabiliserAt <= resolutionAt) {
      fail(`${label}: the destabilising detail arrives before the resolution it undoes`);
    }
  },

  'promise-violation': (label, plan) => {
    const promise = (plan.agentReport.promise as string | undefined) ?? '';
    const violation = (plan.agentReport.violation as string | undefined) ?? '';
    if (!promise || !violation) fail(`${label}: promise or violation missing from the report`);
    const sections = sungSections(plan);
    const promiseAt = sections.findIndex((section) => section.lines.includes(promise));
    const violationAt = sections.findIndex((section) => section.lines.includes(violation));
    if (promiseAt < 0) fail(`${label}: the promise is never stated`);
    if (violationAt >= 0 && promiseAt >= 0 && violationAt <= promiseAt) {
      fail(`${label}: the promise is broken before it is made`);
    }
  },

  'confession-denial': (label, plan) => {
    const confession = (plan.agentReport.confession as string | undefined) ?? '';
    const denial = (plan.agentReport.denial as string | undefined) ?? '';
    const deeper = (plan.agentReport.deeper as string | undefined) ?? '';
    if (!confession || !denial || !deeper) fail(`${label}: confession, denial or deeper reveal missing`);
    if (confession === denial) fail(`${label}: the denial repeats the confession`);
    if (deeper === confession) fail(`${label}: the deeper reveal repeats the first confession`);
    for (const [name, line] of [['confession', confession], ['denial', denial], ['deeper', deeper]] as const) {
      if (line && timesSung(plan, line) < 1) fail(`${label}: the ${name} is never sung: ${line}`);
    }
  },

  'character-choice': (label, plan) => {
    for (const field of ['desire', 'dilemma', 'choice', 'consequence'] as const) {
      const line = (plan.agentReport[field] as string | undefined) ?? '';
      if (!line) fail(`${label}: no ${field} reported`);
      else if (timesSung(plan, line) < 1) fail(`${label}: the ${field} is never sung: ${line}`);
    }
  },

  'escalating-stakes': (label, plan, language) => {
    const steps = ((plan.agentReport.steps as string[] | undefined) ?? []).filter(Boolean);
    const bank = (resolvePack(language).pack.primitives?.ladder ?? []).filter(Boolean);
    const sung = new Set(sungLines(plan));
    const used = steps.filter((step) => sung.has(step));
    if (used.length < 4) fail(`${label}: only ${used.length} escalation step(s) sung, expected 4+`);
    // Order *is* the engine: the steps sung must appear in the bank's own order.
    const indices = used.map((step) => bank.indexOf(step));
    for (let index = 1; index < indices.length; index += 1) {
      if (indices[index] < indices[index - 1]) {
        fail(`${label}: the escalation is out of order (${indices.join(' -> ')})`);
        break;
      }
    }
  },

  countdown: (label, plan, language) => {
    const deadline = (plan.agentReport.deadline as string | undefined) ?? '';
    const decision = (plan.agentReport.decision as string | undefined) ?? '';
    if (!deadline) fail(`${label}: no deadline reported`);
    const sections = sungSections(plan);
    const deadlineAt = sections.findIndex((section) => section.lines.includes(deadline));
    if (deadlineAt > 1) fail(`${label}: the deadline arrives in section ${deadlineAt + 1}, too late to be a clock`);
    if (!decision || timesSung(plan, decision) < 1) fail(`${label}: no decision at the end`);
    const bank = (resolvePack(language).pack.primitives?.ladder ?? []).filter(Boolean);
    const obstacles = ((plan.agentReport.obstacles as string[] | undefined) ?? []).filter((line) =>
      sungLines(plan).includes(line),
    );
    const indices = obstacles.map((line) => bank.indexOf(line)).filter((index) => index >= 0);
    for (let index = 1; index < indices.length; index += 1) {
      if (indices[index] < indices[index - 1]) {
        fail(`${label}: the countdown runs backwards (${indices.join(' -> ')})`);
        break;
      }
    }
  },

  'thought-actually': (label, plan) => {
    const belief = (plan.agentReport.belief as string | undefined) ?? '';
    const contradiction = (plan.agentReport.contradiction as string | undefined) ?? '';
    const revised = (plan.agentReport.revised as string | undefined) ?? '';
    if (!belief || !contradiction || !revised) fail(`${label}: belief, contradiction or revision missing`);
    if (revised === belief) fail(`${label}: the revised belief repeats the original one`);
    const sections = sungSections(plan);
    const beliefAt = sections.findIndex((section) => section.lines.includes(belief));
    const revisedAt = sections.findIndex((section) => section.lines.includes(revised));
    if (beliefAt < 0) fail(`${label}: the belief is never stated`);
    if (revisedAt >= 0 && beliefAt >= 0 && revisedAt <= beliefAt) {
      fail(`${label}: the belief is revised before it is stated`);
    }
    for (const [name, line] of [['contradiction', contradiction], ['revision', revised]] as const) {
      if (line && timesSung(plan, line) < 1) fail(`${label}: the ${name} is never sung: ${line}`);
    }
  },

  'everybody-says': (label, plan) => {
    const belief = (plan.agentReport.belief as string | undefined) ?? '';
    const contradiction = (plan.agentReport.contradiction as string | undefined) ?? '';
    const conclusion = (plan.agentReport.conclusion as string | undefined) ?? '';
    if (!belief || !contradiction || !conclusion) fail(`${label}: belief, contradiction or conclusion missing`);
    const sections = sungSections(plan);
    const at = (line: string) => sections.findIndex((section) => section.lines.includes(line));
    // The argument has an order: received wisdom, the evidence against it, then the conclusion.
    if (at(belief) > at(contradiction)) fail(`${label}: the evidence comes before the belief it tests`);
    if (at(conclusion) < at(contradiction)) fail(`${label}: the conclusion arrives before the contradiction`);
  },

  'call-response': (label, plan) => {
    const response = (plan.agentReport.response as string | undefined) ?? '';
    const escalation = (plan.agentReport.escalation as string | undefined) ?? '';
    if (!response || !escalation) fail(`${label}: response or escalation missing`);
    const calls = ((plan.agentReport.calls as string[] | undefined) ?? []).filter(Boolean);
    if (new Set(calls).size !== calls.length) fail(`${label}: the calls repeat within one song`);
    // The answer comes back untouched until the end, then changes exactly once.
    if (timesSung(plan, response) < 3) fail(`${label}: the response is sung ${timesSung(plan, response)}x, expected 3+`);
    if (escalation === response) fail(`${label}: the escalation is the same line as the response`);
    if (timesSung(plan, escalation) < 1) fail(`${label}: the escalation is never sung`);
    if (plan.repetitionPolicy !== 'device') fail(`${label}: a fixed response is a device`);
  },

  'specific-universal': (label, plan, language) => {
    const implication = (plan.agentReport.implication as string | undefined) ?? '';
    const universal = (plan.agentReport.universal as string | undefined) ?? '';
    if (!implication || !universal) fail(`${label}: implication or universal statement missing`);
    const sections = sungSections(plan);
    // The rule this style exists to enforce: the universal truth comes last, never first.
    const universalAt = sections.findIndex((section) => section.lines.includes(universal));
    if (universalAt < 0) fail(`${label}: the universal statement is never sung`);
    if (universalAt === 0) fail(`${label}: the song opens with the universal truth instead of a detail`);
    const bank = bankLines(resolvePack(language).pack, ['universal']);
    if (bank.size > 0 && !bank.has(universal)) fail(`${label}: universal line not from the pack's bank`);
  },

  'image-meaning': (label, plan) => {
    const images = (plan.agentReport.images as string[] | undefined) ?? [];
    const meaning = (plan.agentReport.meaning as string | undefined) ?? '';
    if (new Set(images).size < 3) fail(`${label}: only ${new Set(images).size} distinct image(s)`);
    if (!meaning) fail(`${label}: no meaning line reported`);
    // The meaning has to arrive after the images, never first.
    const meaningAt = sungSections(plan).findIndex((section) => section.lines.includes(meaning));
    if (meaningAt === 0) fail(`${label}: the meaning line leads the song instead of closing it`);
  },
};

/** Dispatches to the style's own assertions; a style without any cannot pass silently. */
function checkEngine(label: string, plan: LyricPlan, language: string): void {
  const check = ENGINE_CHECKS[plan.agent];
  if (!check) {
    fail(`${label}: no engine assertions exist for style '${plan.agent}' (add them with the style)`);
    return;
  }
  check(label, plan, language);
}

const average = (values: number[]): number =>
  values.length === 0 ? 0 : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;

const agents = listAgents();
console.log(`styles registered: ${agents.length} (${agents.map((agent) => agent.id).join(', ')})`);

for (const testCase of CASES) {
  const pack = resolvePack(testCase.language).pack;
  console.log(
    `\n=== ${testCase.market.toUpperCase()} / ${testCase.genre} / ${testCase.language} (${pack.nativeLabel}) ===`,
  );

  // Styles whose primitives this pack lacks are forced here to prove they degrade rather than
  // crash; the count of skipped engine checks is reported below rather than hidden.
  let skippedEngineChecks = 0;

  // Iterate the real agents, not their descriptors: coverage has to be asked of the object
  // that owns `needs`, or every coverage check passes vacuously.
  for (const agent of AGENTS) {
    const realised = coversPrimitives(pack, agent.needs);
    const scores: number[] = [];
    const meterFits: number[] = [];

    for (const seed of SEEDS) {
      const label = `${testCase.language}/${agent.id}/seed${seed}`;
      const plan = render(testCase, seed, agent.id);
      const validation = checkQuality(label, plan, testCase.language, realised);

      // Engine assertions apply to a *realised* style. A style forced onto a pack that lacks its
      // primitives is expected to degrade onto that pack's general material, so asserting "the
      // refrain returns word-for-word" there would be asserting the impossible; the contract for
      // that case is the quality bars plus `agentRealised: false`, which checkQuality enforces.
      if (realised) checkEngine(label, plan, testCase.language);
      else skippedEngineChecks += 1;

      // 3. Repetition policy: a device style must not be scored as if it had a defect, and a
      // fault style must not actually contain one.
      if (agent.repetition === 'device') {
        if (validation.repetition !== 0) {
          fail(`${label}: device style still scored as a fault (${validation.repetition})`);
        }
      } else if (validation.repetition !== 0) {
        fail(`${label}: repetition fault ${validation.repetition}`);
      }

      scores.push(validation.score);
      meterFits.push(validation.meterFit);

      if (PRINT && seed === SEEDS[0]) {
        console.log(`\n--- ${agent.id} (seed ${seed}) ---`);
        console.log(`  summary: ${plan.agentSummary}`);
        console.log(plan.lyrics.split('\n').map((line) => `  ${line}`).join('\n'));
      }
    }

    console.log(
      `  ${realised ? 'ok ' : 'n/a'} ${agent.id.padEnd(20)} score ${average(scores)}  meterFit ${average(meterFits)}` +
        `${realised ? '' : '  (pack lacks its primitives: forced, degraded, engine checks skipped)'}`,
    );
  }

  if (skippedEngineChecks > 0) {
    console.log(
      `  ${skippedEngineChecks} degraded run(s): engine checks skipped because this pack lacks the primitives`,
    );
  }

  // 4. Rotation must never hand a pack a style it cannot write.
  const chosen = new Set<string>();
  for (const seed of SEEDS) chosen.add(render(testCase, seed).agent);
  console.log(`  chosen by rotation: ${[...chosen].join(', ')}`);
  for (const id of chosen) {
    const agent = AGENTS.find((entry) => entry.id === id);
    if (agent && !coversPrimitives(pack, agent.needs)) {
      fail(`${testCase.language}: rotation chose '${id}', which the pack cannot write`);
    }
  }
}

// 5. Structure varies across a market's designs, not only the words in them.
console.log('\nvariety in one market (structure x subject, 8 seeds):');
const combinations = new Map<string, number>();
for (let seed = 1; seed <= 8; seed += 1) {
  const plan = render(CASES[0], seed);
  const key = `${plan.agent} / ${plan.subject}`;
  combinations.set(key, (combinations.get(key) ?? 0) + 1);
}
for (const [key, count] of combinations) console.log(`  ${count}x ${key}`);
if (combinations.size < 3) fail(`only ${combinations.size} structure/subject combination(s) in 8 designs`);

console.log(failures === 0 ? '\nPASS: writing styles cleared' : `\nFAIL: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);


