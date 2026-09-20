/**
 * Subject-spread check.
 *
 * `lyric-pack-acceptance.ts` proves a pack writes its own language; this proves the
 * generator is not subject-constrained. Four properties, each of which was false
 * before the subject engine existed:
 *
 *   1. every registered pack declares at least `MIN_SUBJECTS` subjects it can write;
 *   2. a design run rotates through them instead of handing one market one story;
 *   3. forcing two different subjects onto the same seed changes the lyrics, so the
 *      subject is not merely recorded - it is written;
 *   4. a chart word in the pack's own script is usable as an ad-lib, and a Latin
 *      chart word never leaks into a non-Latin pack.
 *
 *   npx tsx scripts/subject-spread.ts
 */
import { writeLyrics, type LyricPlan } from '../src/design/lyrics.js';
import { availableLanguages, resolvePack } from '../src/design/lyrics/index.js';
import { subjectIds } from '../src/design/lyrics/subjects.js';

const MIN_SUBJECTS = 3;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const THEMES = ['late-night city life', 'connection', 'celebration'];
const TERMS = ['midnight', 'harbour', 'holding on'];

let failures = 0;

function fail(message: string): void {
  failures += 1;
  console.log(`  FAIL  ${message}`);
}

/** Renders with every other subject excluded, so the choice collapses onto one. */
function forceSubject(code: string, subject: string): LyricPlan {
  return writeLyrics({
    themes: THEMES,
    terms: TERMS,
    energy: 0.6,
    language: code,
    genre: 'pop',
    seed: 7,
    usedSubjects: subjectIds().filter((id) => id !== subject),
  });
}

for (const language of availableLanguages()) {
  const pack = resolvePack(language.code).pack;
  const coverage = pack.subjectCoverage ?? [];

  console.log(`\n${language.code} (${language.nativeLabel}) - ${coverage.length} subject(s) declared`);
  if (coverage.length < MIN_SUBJECTS) {
    fail(`${language.code}: only ${coverage.length} subject(s), need ${MIN_SUBJECTS}`);
  }

  // 2. Rotation: accumulate what has been used, exactly as `designConcepts` does.
  const used: string[] = [];
  const seen = new Set<string>();
  for (const seed of SEEDS) {
    const plan = writeLyrics({
      themes: THEMES,
      terms: TERMS,
      energy: 0.6,
      language: language.code,
      genre: 'pop',
      seed,
      usedSubjects: [...used],
    });
    if (!plan.subjectRealised) fail(`${language.code}: subject '${plan.subject}' not realised by the pack`);
    if (coverage.length > 0 && !coverage.includes(plan.subject)) {
      fail(`${language.code}: subject '${plan.subject}' outside declared coverage`);
    }
    used.push(plan.subject);
    seen.add(plan.subject);
  }
  console.log(`  rotated through ${seen.size} subject(s): ${[...seen].join(', ')}`);
  if (seen.size < Math.min(MIN_SUBJECTS, coverage.length)) {
    fail(`${language.code}: ${seen.size} distinct subject(s) across ${SEEDS.length} runs`);
  }

  // 3. The subject has to change the lyric, not just the label.
  const forced = coverage.slice(0, Math.min(coverage.length, 4)).map((subject) => ({
    subject,
    lyrics: forceSubject(language.code, subject).lyrics,
  }));
  const distinctLyrics = new Set(forced.map((entry) => entry.lyrics));
  console.log(`  ${distinctLyrics.size}/${forced.length} forced subject(s) produced distinct lyrics`);
  if (forced.length > 1 && distinctLyrics.size < forced.length) {
    fail(`${language.code}: different subjects produced identical lyrics`);
  }
}

// 4. Script-aware ad-libs: the market's own chart word must be usable...
const hangulTerm = '사랑';
const hanTerm = '我不难过';
const koreanAdlib = writeLyrics({
  themes: THEMES,
  terms: [hangulTerm, 'midnight'],
  energy: 0.5,
  language: 'ko',
  genre: 'k_pop',
  seed: 11,
});
const chineseAdlib = writeLyrics({
  themes: THEMES,
  terms: [hanTerm, 'midnight'],
  energy: 0.5,
  language: 'zh',
  genre: 'regional_east_asia',
  seed: 11,
});
const latinOnlyKorean = writeLyrics({
  themes: THEMES,
  terms: TERMS,
  energy: 0.5,
  language: 'ko',
  genre: 'k_pop',
  seed: 11,
});

console.log('\nad-lib script handling');
if (koreanAdlib.topicWord !== hangulTerm) {
  fail(`ko: expected the Hangul chart word '${hangulTerm}', got '${koreanAdlib.topicWord ?? 'none'}'`);
}
if (chineseAdlib.topicWord !== hanTerm) {
  fail(`zh: expected the Han chart word '${hanTerm}', got '${chineseAdlib.topicWord ?? 'none'}'`);
}
// ...and a Latin chart word must never be injected into a non-Latin lyric.
if (latinOnlyKorean.topicWord !== undefined) {
  fail(`ko: Latin chart word '${latinOnlyKorean.topicWord}' was accepted as an ad-lib`);
}
console.log(`  ko ad-lib '${koreanAdlib.topicWord ?? 'none'}', zh ad-lib '${chineseAdlib.topicWord ?? 'none'}', ko with Latin chart: ${latinOnlyKorean.topicWord ?? 'none'}`);

// 5. Chart words must actually influence the subject where the script can be compared.
const familyLed = writeLyrics({
  themes: ['family', 'belonging'],
  terms: ['mother', 'home', 'kitchen'],
  energy: 0.5,
  language: 'en',
  genre: 'pop',
  seed: 3,
});
const partyLed = writeLyrics({
  themes: ['celebration', 'summer'],
  terms: ['party', 'dancing', 'tonight'],
  energy: 0.5,
  language: 'en',
  genre: 'pop',
  seed: 3,
});
console.log(`\nchart-topic matching\n  family chart -> ${familyLed.subject} (${familyLed.subjectSource}: ${familyLed.subjectMatched})`);
console.log(`  party chart  -> ${partyLed.subject} (${partyLed.subjectSource}: ${partyLed.subjectMatched})`);
if (familyLed.subjectSource !== 'chart-topic' || partyLed.subjectSource !== 'chart-topic') {
  fail('chart words did not drive the subject');
}
if (familyLed.subject === partyLed.subject) {
  fail('two unrelated charts picked the same subject');
}

console.log(failures === 0 ? '\nPASS: subject spread cleared' : `\nFAIL: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
