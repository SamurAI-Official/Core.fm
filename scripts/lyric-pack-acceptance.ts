/**
 * Acceptance check for a lyric language pack.
 *
 * `lyric-validate-suite.ts` pins the *validator* per script. This checks a *pack*:
 * that a market asking for language X really gets X (no silent English fallback), in
 * the right script, with lines inside the comfortable meter band, and without any
 * borrowed cliche. This is the gate that makes "we support language X" checkable
 * instead of assertable.
 *
 *   npx tsx scripts/lyric-pack-acceptance.ts ru
 *   npx tsx scripts/lyric-pack-acceptance.ts ru ja ko zh
 */
import { writeLyrics, validateLyricPlan } from '../src/design/lyrics.js';
import { resolvePack } from '../src/design/lyrics/index.js';

const codes = process.argv.slice(2);
if (codes.length === 0) {
  console.error('usage: npx tsx scripts/lyric-pack-acceptance.ts <lang> [lang...]');
  process.exit(2);
}

const GENRES = ['pop', 'hip_hop_rap', 'electronic_dance', 'latin'];
const SEEDS = [1, 2, 3, 4, 5, 6];

/** Bars a pack must clear before it counts as supported. */
const MIN_METER_FIT = 0.5;
const MIN_SCRIPT_CONSISTENCY = 0.9;
const MIN_SCORE = 0.6;

let failures = 0;

for (const code of codes) {
  const resolution = resolvePack(code);
  if (resolution.fallback) {
    console.log(`FAIL ${code}: no pack available (${resolution.reason})`);
    failures += 1;
    continue;
  }

  const scores: number[] = [];
  const meterFits: number[] = [];
  let sample = '';

  for (const seed of SEEDS) {
    const plan = writeLyrics({
      themes: ['late nights', 'the long way home'],
      terms: ['midnight', 'harbour'],
      energy: 0.3 + (seed % 3) * 0.3,
      language: code,
      genre: GENRES[seed % GENRES.length],
      seed,
    });
    const validation = validateLyricPlan(plan, { bpm: 100, timeSignature: '4/4' });

    const problems: string[] = [];
    if (plan.languageFallback) problems.push('fell back to another language');
    if (plan.language !== code) problems.push(`wrote '${plan.language}' not '${code}'`);
    if (validation.scriptConsistency < MIN_SCRIPT_CONSISTENCY) {
      problems.push(`script consistency ${validation.scriptConsistency} < ${MIN_SCRIPT_CONSISTENCY}`);
    }
    if (validation.detectedScript !== plan.script) {
      problems.push(`detected '${validation.detectedScript}' but the pack script is '${plan.script}'`);
    }
    if (validation.cliches.length > 0) problems.push(`cliches: ${validation.cliches.join(', ')}`);
    if (validation.meterFit < MIN_METER_FIT) {
      problems.push(`meterFit ${validation.meterFit} < ${MIN_METER_FIT}`);
    }
    if (validation.score < MIN_SCORE) problems.push(`score ${validation.score} < ${MIN_SCORE}`);

    scores.push(validation.score);
    meterFits.push(validation.meterFit);
    if (!sample) sample = plan.lyrics;

    if (problems.length > 0) {
      failures += 1;
      console.log(`  FAIL  ${code}/seed${seed}: ${problems.join('; ')}`);
    } else {
      console.log(
        `  ok    ${code}/seed${seed}  score ${validation.score}  meterFit ${validation.meterFit}  ` +
          `rhyme ${validation.rhymeDensity}  script ${validation.scriptConsistency}`,
      );
    }
  }

  const average = (values: number[]): number =>
    Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
  console.log(`\n${code} (${resolution.pack.nativeLabel}) avg score ${average(scores)}, avg meterFit ${average(meterFits)}`);
  console.log('--- sample ---');
  console.log(sample);
  console.log('--- end sample ---\n');
}

console.log(failures === 0 ? 'PASS: all pack checks cleared' : `FAIL: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
