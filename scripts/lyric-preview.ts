/**
 * Lyric arc preview: prints the generator's output for a spread of
 * market/genre/language combinations, with the singability validation, so the arc,
 * the grammar and the language fallbacks can all be checked before a render.
 *
 *   npx tsx scripts/lyric-preview.ts [seed]
 */
import { writeLyrics, validateLyricPlan } from '../src/design/lyrics.js';
import { GENRE_STYLE } from '../src/design/genreStyle.js';
import { flavorFor } from '../src/design/marketFlavor.js';
import { availableLanguages } from '../src/design/lyrics/index.js';

const seed = Number(process.argv[2] ?? 1);

/** `language` is what the market requests; the pack may or may not exist. */
const cases: Array<{ market: string; genre: string; language: string }> = [
  { market: 'us', genre: 'country', language: 'en' },
  { market: 'ng', genre: 'afrobeats', language: 'en' },
  { market: 'gb', genre: 'rock', language: 'en' },
  { market: 'fr', genre: 'hip_hop_rap', language: 'fr' },
  { market: 'de', genre: 'singer_songwriter', language: 'de' },
  { market: 'es', genre: 'reggaeton', language: 'es' },
  { market: 'it', genre: 'pop', language: 'it' },
  { market: 'br', genre: 'pop', language: 'pt' },
  // No pack yet: these must report a fallback rather than claim the language.
  { market: 'jp', genre: 'j_pop', language: 'ja' },
  { market: 'kr', genre: 'k_pop', language: 'ko' },
  { market: 'cn', genre: 'regional_east_asia', language: 'zh' },
  { market: 'ru', genre: 'pop', language: 'ru' },
  { market: 'in', genre: 'regional_south_asian', language: 'hi' },
];

console.log(`packs available: ${availableLanguages().map((l) => `${l.code} (${l.nativeLabel})`).join(', ')}`);
console.log('');

let scored = 0;
let fallbacks = 0;

for (const [index, testCase] of cases.entries()) {
  const flavor = flavorFor(testCase.market);
  const energy = GENRE_STYLE[testCase.genre]?.energy ?? 0.6;
  // A representative tempo/meter per genre so the validator has real numbers.
  const bpm = testCase.genre === 'hip_hop_rap' ? 92 : testCase.genre === 'house_techno' ? 126 : 112;
  const plan = writeLyrics({
    themes: flavor.themes,
    terms: ['midnight', 'signal', 'home'],
    energy,
    language: testCase.language,
    genre: testCase.genre,
    seed: seed + index * 7919,
  });

  const validation = validateLyricPlan(plan, { bpm, timeSignature: '4/4' });
  scored += 1;
  if (plan.languageFallback) fallbacks += 1;

  const languageLine = plan.languageFallback
    ? `${testCase.language} -> FELL BACK TO ${plan.language} (${plan.languageNote})`
    : `${plan.language} (${plan.packLabel})`;

  console.log('='.repeat(78));
  console.log(
    `${testCase.market.toUpperCase()} / ${testCase.genre} @ ${bpm} BPM (energy ${energy}) -> ` +
      `${plan.structure.length} sections`,
  );
  console.log(`language : ${languageLine}`);
  console.log(`hook     : ${plan.hook}`);
  console.log(`metaphor : ${plan.arc.metaphor}`);
  console.log(`contradiction: ${plan.arc.contradiction.join('  /  ')}`);
  console.log(`conclusion: ${plan.arc.conclusion}`);
  console.log(
    `singability: ${validation.score} (meter ${validation.meterFit}, rhyme ${validation.rhymeDensity}, ` +
      `script ${validation.scriptConsistency}, syllables ${validation.syllableRange.min}-` +
      `${validation.syllableRange.max} vs target ${validation.targetSyllables})`,
  );
  if (validation.issues.length > 0) console.log(`issues   : ${validation.issues.join(' | ')}`);
  console.log('-'.repeat(78));
  console.log(plan.lyrics);
  console.log('');
}

console.log('='.repeat(78));
console.log(`previewed ${scored} concept(s); ${fallbacks} fell back to English.`);
