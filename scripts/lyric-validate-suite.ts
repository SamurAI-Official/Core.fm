/**
 * Lyric validator fixture suite.
 *
 * `validate.ts` is the gate that decides whether a lyric is worth GPU time, and it
 * had no tests at all - which is exactly how two silent failures survived: Russian
 * lines measured as one syllable (the script fell through to a Latin counter that
 * strips non-Latin characters) and non-Latin rhyme never detected, costing those
 * languages 0.2 of every score without a single error being raised.
 *
 * These fixtures pin the behaviour per script. They are deliberately exact about
 * things that must be exact (mora counts, script detection, junk filtering) and
 * range-based about things that are genuinely estimates (Latin syllable counts).
 *
 *   npx tsx scripts/lyric-validate-suite.ts
 */
import { estimateSyllables, validateLyrics } from '../src/design/lyrics/validate.js';
import { detectScript, tokenizeText, contentTokensText } from '../src/lib/text.js';
import { contentTokens } from '../src/lib/util.js';

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    passed += 1;
    console.log(`  ok    ${name}`);
    return;
  }
  failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`  FAIL  ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function checkIn(name: string, actual: number, min: number, max: number): void {
  if (actual >= min && actual <= max) {
    passed += 1;
    console.log(`  ok    ${name} (${actual})`);
    return;
  }
  failures.push(`${name}: expected ${min}..${max}, got ${actual}`);
  console.log(`  FAIL  ${name}: expected ${min}..${max}, got ${actual}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
section('Syllables per script');
// ---------------------------------------------------------------------------
// The regression that mattered: this used to report 1, because Cyrillic fell
// through to the Latin counter which strips everything outside [a-z\u00e0-\u024f].
checkIn('cyrillic "Я знаю этот город" (7 vowels)', estimateSyllables('Я знаю этот город', 'cyrillic'), 6, 8);
checkIn('cyrillic "Привет, как дела" (5 vowels)', estimateSyllables('Привет, как дела', 'cyrillic'), 4, 6);

// Kana are one mora each; small kana add none.
check('japanese "こんばんは" = 5 morae', estimateSyllables('こんばんは', 'japanese'), 5);
check('japanese "きょう" = 2 morae (small ょ adds none)', estimateSyllables('きょう', 'japanese'), 2);
check('japanese "東京" = 2 (kanji approximated at one mora)', estimateSyllables('東京', 'japanese'), 2);

// Each Hangul syllable block is one syllable.
check('hangul "안녕하세요" = 5', estimateSyllables('안녕하세요', 'hangul'), 5);
check('hangul "사랑" = 2', estimateSyllables('사랑', 'hangul'), 2);

// Mandarin is one syllable per Han character.
check('han "我不难过" = 4', estimateSyllables('我不难过', 'han'), 4);

// Latin regression: must not have shifted.
check("latin \"It's midnight on this street\" = 6", estimateSyllables("It's midnight on this street", 'latin'), 6);

// ---------------------------------------------------------------------------
section('Script detection');
// ---------------------------------------------------------------------------
check('kana wins over kanji ("怪獣の花唄")', detectScript('怪獣の花唄'), 'japanese');
check('pure han is han ("我不难过")', detectScript('我不难过'), 'han');
check('cyrillic ("Шадэ")', detectScript('Шадэ'), 'cyrillic');
check('hangul ("사랑")', detectScript('사랑'), 'hangul');
check('latin ("Girls Need Love")', detectScript('Girls Need Love'), 'latin');

// ---------------------------------------------------------------------------
section('Tokenization (was empty for every non-Latin title)');
// ---------------------------------------------------------------------------
const jpTokens = tokenizeText('怪獣の花唄');
check('japanese title yields bigrams (5 chars -> 4)', jpTokens.length, 4);
check('cyrillic title yields a token', tokenizeText('Шадэ').join(','), 'шадэ');
check('latin still tokenized', tokenizeText('Girls Need Love').join(','), 'girls,need,love');
check('japanese single char is kept whole', tokenizeText('花').join(','), '花');

// Documents the exact defect this replaced, so it cannot silently return: the old
// ASCII-only tokenizer produced *nothing* for a Japanese title, so every jaccard
// comparison against it scored exactly 0 (novelty scoring, market fit, Deezer match).
function oldAsciiTokenize(input: string): string[] {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}
check('OLD tokenizer: 0 tokens for a JP title', oldAsciiTokenize('怪獣の花唄').length, 0);
checkIn('new tokenizer: JP title now yields tokens', tokenizeText('怪獣の花唄').length, 4, 4);
check('OLD tokenizer: 0 tokens for a Cyrillic title', oldAsciiTokenize('Шадэ').length, 0);

// ---------------------------------------------------------------------------
section('Content tokens: chart junk still filtered, CJK now kept');
// ---------------------------------------------------------------------------
check('acronym filtered ("GTAVI")', contentTokens('GTAVI').length, 0);
// Documents existing behaviour: only the numeric token is dropped, the word is kept.
check('number token dropped ("Track 2" -> "track")', contentTokens('Track 2').join(','), 'track');
check('vowel-less filtered ("rhythm")', contentTokens('rhythm').length, 0);
check('latin content kept', contentTokens('midnight drive').join(','), 'midnight,drive');
check('cjk title kept', contentTokensText('怪獣の花唄').join(','), '怪獣の花唄');
check('cjk function char rejected ("の")', contentTokensText('の').length, 0);
check('cyrillic word kept', contentTokensText('Шадэ').join(','), 'шадэ');

// ---------------------------------------------------------------------------
section('Rhyme per script (was always false outside Latin)');
// ---------------------------------------------------------------------------
const ru = validateLyrics('[Verse 1]\nЯ знаю этот город\nЯ знаю этот холод', {
  language: 'ru',
  script: 'cyrillic',
  bpm: 92,
  timeSignature: '4/4',
});
check('cyrillic rhyme density', ru.rhymeDensity, 1);
check('cyrillic script consistency', ru.scriptConsistency, 1);
checkIn('cyrillic syllable min (not 1)', ru.syllableRange.min, 5, 9);

const ja = validateLyrics('[Verse 1]\nゆめをみる\nそらをみる', {
  language: 'ja',
  script: 'japanese',
  bpm: 110,
  timeSignature: '4/4',
});
check('japanese rhyme density', ja.rhymeDensity, 1);
check('japanese script consistency', ja.scriptConsistency, 1);

const ko = validateLyrics('[Verse 1]\n사랑을 노래해\n바람을 노래해', {
  language: 'ko',
  script: 'hangul',
  bpm: 110,
  timeSignature: '4/4',
});
check('hangul rhyme density', ko.rhymeDensity, 1);
check('hangul script consistency', ko.scriptConsistency, 1);

const zh = validateLyrics('[Verse 1]\n我不难过\n你不难过', {
  language: 'zh',
  script: 'han',
  bpm: 100,
  timeSignature: '4/4',
});
check('han rhyme density', zh.rhymeDensity, 1);
check('han syllables per line', zh.syllableRange.min, 4);

// Negative cases: different endings must NOT be reported as rhyme.
const ruNoRhyme = validateLyrics('[Verse 1]\nЯ знаю этот город\nЯ вижу ту стену', {
  language: 'ru',
  script: 'cyrillic',
  bpm: 92,
  timeSignature: '4/4',
});
check('cyrillic non-rhyme reported as 0', ruNoRhyme.rhymeDensity, 0);

const jaNoRhyme = validateLyrics('[Verse 1]\nゆめをみる\nそらをとぶ', {
  language: 'ja',
  script: 'japanese',
  bpm: 110,
  timeSignature: '4/4',
});
check('japanese non-rhyme reported as 0', jaNoRhyme.rhymeDensity, 0);

// ---------------------------------------------------------------------------
section('Cliche matching is accent-insensitive');
// ---------------------------------------------------------------------------
const es = validateLyrics('[Verse 1]\nTengo un corazón de oro', {
  language: 'es',
  script: 'latin',
  bpm: 100,
  timeSignature: '4/4',
});
check('accented cliche matches unaccented bank entry', es.cliches.join(','), 'corazon de oro');

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
if (failures.length === 0) {
  console.log(`PASS: ${passed} check(s)`);
  process.exit(0);
}
console.log(`FAIL: ${failures.length} of ${passed + failures.length} check(s)`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(1);
