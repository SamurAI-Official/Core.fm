/**
 * Writing-style gate.
 *
 * `lyric-pack-acceptance.ts` proves a pack writes its own language and `subject-spread.ts`
 * proves the writer is not subject-bound. This proves the *writing styles* are real:
 *
 *   1. every registered style renders, inside the same bars as everything else (no language
 *      fallback, right script, meter fit, no borrowed cliches);
 *   2. the engine a style claims is actually in the output - a refrain is byte-identical and
 *      repeated, questions come from the pack's question bank without repeats and lengthen
 *      across the song, the arc still produces its own report;
 *   3. repetition is handled per style: a fault where the style says `fault`, the device
 *      where it says `device` (and a device style must really repeat something);
 *   4. a style whose primitives a pack lacks is never *chosen* for it, and if it is forced
 *      anyway it says so (`agentRealised: false`) and still validates instead of crashing;
 *   5. a market's designs vary in structure, not only in words, across seeds.
 *
 *   npx tsx scripts/agent-spread.ts            # checks + summary
 *   npx tsx scripts/agent-spread.ts --print    # plus one sample per style
 */
import { validateLyricPlan, writeLyrics, type LyricPlan } from '../src/design/lyrics.js';
import { AGENTS, listAgents } from '../src/design/agents/registry.js';
import { resolvePack } from '../src/design/lyrics/index.js';
import { coversPrimitives } from '../src/design/lyrics/primitives.js';
import { plainText, sectionMap } from '../src/design/lyrics/validate.js';

const MIN_SCORE = 0.6;
const MIN_METER_FIT = 0.5;
const MIN_SCRIPT_CONSISTENCY = 0.9;
const SEEDS = [1, 2, 3, 4];
const PRINT = process.argv.includes('--print');

const CASES = [
  { market: 'us', genre: 'country', language: 'en' },
  { market: 'kr', genre: 'k_pop', language: 'ko' },
  { market: 'cn', genre: 'regional_east_asia', language: 'zh' },
  // A pack with no primitives yet: styles that need them must degrade, not crash.
  { market: 'fr', genre: 'pop', language: 'fr' },
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
  if (validation.meterFit < MIN_METER_FIT) fail(`${label}: meterFit ${validation.meterFit}`);
  if (validation.score < MIN_SCORE) fail(`${label}: score ${validation.score}`);
  if (plan.agentRealised !== expectedRealised) {
    fail(`${label}: agentRealised ${plan.agentRealised}, expected ${expectedRealised}`);
  }
  return validation;
}

/** What each style claims about its own output, checked against that output. */
function checkEngine(label: string, plan: LyricPlan, language: string): void {
  const sections = sectionMap(plan.lyrics);
  const lines = plainText(plan.lyrics).split('\n').filter(Boolean);

  if (plan.agent === 'arc') {
    if (!plan.arc) fail(`${label}: arc style produced no arc report`);
    if (plan.repetitionPolicy !== 'fault') fail(`${label}: arc should treat repetition as a fault`);
    if (plan.structure.length < 5) fail(`${label}: arc produced ${plan.structure.length} sections`);
    return;
  }

  if (plan.agent === 'refrain-mutation') {
    const restatements = lines.filter((line) => line === plan.hook).length;
    if (restatements < 3) {
      fail(`${label}: refrain sung ${restatements}x, expected at least 3 (the device must be used)`);
    }
    if (plan.repetitionPolicy !== 'device') fail(`${label}: refrain style must mark repetition a device`);
    // The repeated chorus has to be byte-identical, or the refrain is not a refrain.
    const choruses = sections.filter((section) => section.name === 'Chorus');
    if (choruses.length >= 2 && choruses[0].lines.join('|') !== choruses[1].lines.join('|')) {
      fail(`${label}: the repeated chorus is not byte-identical`);
    }
    return;
  }

  if (plan.agent === 'question-answer') {
    const questions = (plan.agentReport.questions as string[] | undefined) ?? [];
    const lengths = (plan.agentReport.questionLengths as number[] | undefined) ?? [];
    const answers = (plan.agentReport.answers as string[] | undefined) ?? [];
    // How much material the pack actually offered, so "repeated because the bank ran out"
    // is not reported as a defect while "repeated when there was more to ask" is.
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
    // Where the pack has the banks, the lines must come from them, not from a fallback.
    const bank = new Set(resolvePack(language).pack.primitives?.question ?? []);
    if (bank.size > 0) {
      const borrowed = questions.filter((question) => !bank.has(question));
      if (borrowed.length > 0) fail(`${label}: question not from the pack's bank: ${borrowed[0]}`);
    }
    return;
  }

  fail(`${label}: no engine assertions exist for style '${plan.agent}' (add them with the style)`);
}

const average = (values: number[]): number =>
  values.length === 0 ? 0 : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;

const agents = listAgents();
console.log(`styles registered: ${agents.map((agent) => agent.id).join(', ')}`);

for (const testCase of CASES) {
  const pack = resolvePack(testCase.language).pack;
  console.log(
    `\n=== ${testCase.market.toUpperCase()} / ${testCase.genre} / ${testCase.language} (${pack.nativeLabel}) ===`,
  );

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
      checkEngine(label, plan, testCase.language);

      // 3. Repetition policy: a device style must not be scored as if it had a defect, and
      // a fault style must not actually contain one.
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
        console.log(
          plan.lyrics
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n'),
        );
      }
    }

    console.log(
      `  ${realised ? 'ok ' : 'n/a'} ${agent.id.padEnd(18)} score ${average(scores)}  meterFit ${average(meterFits)}` +
        `${realised ? '' : '  (pack lacks its primitives: forced, reported, degraded)'}`,
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

