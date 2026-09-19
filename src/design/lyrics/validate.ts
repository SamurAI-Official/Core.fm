/**
 * Singability validation for generated lyrics.
 *
 * The generator can now write in several languages, but "is this good enough to
 * spend GPU time on" needs an answer that does not depend on reading the line.
 * This module measures the things that reliably make a lyric unsingable: lines far
 * too long or short for the tempo, text in the wrong script, a section repeating
 * itself, and borrowed cliches.
 *
 * Honest about its precision: syllable counts are *estimates* from orthography
 * (no dictionary, no phonemizer), so they are used as bands rather than exact
 * targets. The value is in catching a 22-syllable line at 92 BPM, not in being
 * right about whether "every" is two syllables or three.
 */
import { clamp, median, round } from '../../lib/util.js';
import type { ScriptFamily } from './types.js';

export interface LineMetric {
  section: string;
  line: string;
  syllables: number;
  words: number;
}

export interface LyricValidation {
  language: string;
  script: ScriptFamily;
  detectedScript: ScriptFamily | 'mixed';
  lineCount: number;
  /** Syllables a comfortable line spans at this tempo/meter. */
  targetSyllables: number;
  syllableRange: { min: number; median: number; max: number };
  /** Share of lines inside the comfortable band. */
  meterFit: number;
  /** Share of adjacent line pairs that rhyme or assonate. */
  rhymeDensity: number;
  /** Share of lines duplicated inside their own section (should be 0). */
  repetition: number;
  /** Share of characters written in the expected script. */
  scriptConsistency: number;
  cliches: string[];
  issues: string[];
  score: number;
  lines: LineMetric[];
}

/**
 * Script detection patterns.
 *
 * These use Unicode *script properties* rather than code-point ranges. A range like
 * `[\u0041-\u024F]` looks like "Latin" but also contains `[`, `]`, `\`, `^`, `_`
 * and the Latin-1 punctuation block - which silently counted the `[Chorus]` header
 * brackets as letters and pushed the consistency ratio above 1.
 */
const SCRIPT_PATTERNS: Record<ScriptFamily, RegExp> = {
  latin: /\p{Script=Latin}/gu,
  cyrillic: /\p{Script=Cyrillic}/gu,
  devanagari: /\p{Script=Devanagari}/gu,
  japanese: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu,
  hangul: /\p{Script=Hangul}/gu,
  han: /\p{Script=Han}/gu,
  arabic: /\p{Script=Arabic}/gu,
};

/** Latin letters, used as the denominator for script consistency. */
const LETTER = /\p{L}/gu;

/** Small kana attach to the preceding mora and add none of their own. */
const SMALL_KANA = /[\u3041\u3043\u3045\u3047\u3049\u3083\u3085\u3087\u30A1\u30A3\u30A5\u30A7\u30A9\u30E3\u30E5\u30E7]/g;

const CLICHES: Record<string, string[]> = {
  en: ['heart of gold', 'dancing in the rain', 'set me free', 'light up the sky', 'break these chains', 'rise above it all'],
  fr: ['au fond de mon coeur', 'danser sous la pluie', "briser mes chaines", 'voir la lumiere'],
  de: ['im regen tanzen', 'herz aus gold', 'lass mich frei', 'den himmel erleuchten'],
};

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/** Best-guess script of a string. Kana presence wins, since kanji alone is ambiguous. */
export function detectScript(text: string): ScriptFamily | 'mixed' {
  const scores: Array<[ScriptFamily, number]> = (Object.keys(SCRIPT_PATTERNS) as ScriptFamily[]).map(
    (script) => [script, countMatches(text, SCRIPT_PATTERNS[script])],
  );
  const letters = scores.reduce((sum, [, value]) => sum + value, 0);
  if (letters === 0) return 'latin';

  const kana = countMatches(text, /[\u3040-\u30FF]/g);
  if (kana > 0) return 'japanese';

  scores.sort((a, b) => b[1] - a[1]);
  const [top, topCount] = scores[0];
  // Tolerate some foreign words (a name in the title, an English ad-lib) but
  // report genuinely mixed text, which usually means a broken template.
  return topCount / letters >= 0.6 ? top : 'mixed';
}

/** Orthographic syllable estimate for Latin-script words. */
function latinWordSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z\u00e0-\u024f']/g, '');
  if (!w) return 0;
  const groups = w.match(/[aeiouy\u00e0-\u00ff]+/g) ?? [];
  let count = groups.length;
  // Silent final 'e' ("time" -> 1) except where it forms its own syllable after a
  // consonant + l ("little" -> 2).
  const silentFinalE = /[^aeiou]e$/.test(w) && !/[^aeiou]le$/.test(w);
  if (silentFinalE && count > 1) count -= 1;
  return Math.max(1, count);
}

/**
 * Estimated syllables (or morae, for Japanese) in one line.
 * Section headers must be stripped by the caller.
 */
export function estimateSyllables(line: string, script: ScriptFamily): number {
  const text = line.replace(/[()]/g, ' ').trim();
  if (!text) return 0;

  if (script === 'japanese') {
    const kana = countMatches(text, /[\u3040-\u30FF]/g);
    const small = countMatches(text, SMALL_KANA);
    const kanji = countMatches(text, /[\u4E00-\u9FFF]/g);
    // Kanji are approximated at one mora per character; without a reading
    // dictionary that is the best available estimate.
    return Math.max(1, kana - small + kanji);
  }
  if (script === 'devanagari') {
    // Base letters only: matras and other combining marks are not syllables.
    return Math.max(1, countMatches(text, /[\u0900-\u0939\u0958-\u095F\u0960-\u0961]/g));
  }
  if (script === 'hangul') {
    return Math.max(1, Math.round(countMatches(text, /[\uAC00-\uD7AF]/g) * 1.0));
  }
  if (script === 'han') {
    return Math.max(1, countMatches(text, /[\u4E00-\u9FFF]/g));
  }

  const words = text.split(/\s+/).filter(Boolean);
  return Math.max(1, words.reduce((sum, word) => sum + latinWordSyllables(word), 0));
}

/** Beats in one bar, honouring the meter (6/8 counts two beats of three). */
export function beatsPerBar(timeSignature: string): number {
  const [numerator, denominator] = timeSignature.split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 4;
  return (numerator * 4) / denominator;
}

/**
 * Syllables a line can comfortably hold: a two-bar phrase at this tempo.
 *
 * Faster songs leave less time per bar, so the allowance per beat shrinks with
 * tempo (clamped, so extreme BPM values cannot produce absurd targets).
 */
export function targetSyllablesPerLine(bpm: number, timeSignature: string, barsPerLine = 2): number {
  const safeBpm = bpm && bpm > 0 ? bpm : 110;
  const syllablesPerBeat = clamp(120 / safeBpm, 0.6, 1.2);
  return Math.max(3, round(beatsPerBar(timeSignature) * barsPerLine * syllablesPerBeat, 1));
}

/** Tail of a word: final vowel nucleus plus whatever follows it. */
function phoneticTail(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z\u00e0-\u024f]/g, '');
  const match = w.match(/[aeiouy\u00e0-\u00ff][^aeiouy\u00e0-\u00ff]*$/);
  return match ? match[0] : w.slice(-3);
}

/** True when two line endings share a sound, i.e. rhyme or assonance. */
function rhymes(a: string, b: string): boolean {
  const lastA = a.trim().split(/\s+/).pop() ?? '';
  const lastB = b.trim().split(/\s+/).pop() ?? '';
  const tailA = phoneticTail(lastA);
  const tailB = phoneticTail(lastB);
  if (!tailA || !tailB || tailA.length < 2 || tailB.length < 2) return false;
  return tailA === tailB;
}

interface ParsedSection {
  name: string;
  lines: string[];
}

/** Splits lyrics into sections, keeping only lyric lines (not `[Section]` headers). */
function parseSections(lyrics: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection = { name: 'body', lines: [] };

  for (const raw of lyrics.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      if (current.lines.length > 0) sections.push(current);
      current = { name: header[1], lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.length > 0) sections.push(current);
  return sections;
}

export interface ValidateOptions {
  language: string;
  script: ScriptFamily;
  bpm: number;
  timeSignature: string;
  barsPerLine?: number;
}

/**
 * Measures a generated lyric and returns an explainable singability score.
 * Never throws: malformed or empty lyrics produce an empty result, so validation
 * can never block a design cycle - it only reports.
 */
export function validateLyrics(lyrics: string, options: ValidateOptions): LyricValidation {
  const { language, script, bpm, timeSignature } = options;
  const sections = parseSections(lyrics ?? '');
  const allLines = sections.flatMap((section) =>
    section.lines.map((line) => ({ section: section.name, line })),
  );

  const metrics: LineMetric[] = allLines.map((entry) => ({
    section: entry.section,
    line: entry.line,
    syllables: estimateSyllables(entry.line, script),
    words: entry.line.split(/\s+/).filter(Boolean).length,
  }));

  const target = targetSyllablesPerLine(bpm, timeSignature, options.barsPerLine);
  const syllables = metrics.map((metric) => metric.syllables);

  if (metrics.length === 0) {
    return {
      language,
      script,
      detectedScript: script,
      lineCount: 0,
      targetSyllables: target,
      syllableRange: { min: 0, median: 0, max: 0 },
      meterFit: 0,
      rhymeDensity: 0,
      repetition: 0,
      scriptConsistency: 1,
      cliches: [],
      issues: ['no lyric lines to validate'],
      score: 0,
      lines: [],
    };
  }

  const lowEnd = target * 0.5;
  const highEnd = target * 1.5;
  const inBand = metrics.filter((metric) => metric.syllables >= lowEnd && metric.syllables <= highEnd);
  const meterFit = round(inBand.length / metrics.length, 3);

  // Adjacent pairs within one section only: a chorus rhyming with a verse means
  // nothing.
  let pairCount = 0;
  let rhymingPairs = 0;
  for (const section of sections) {
    for (let index = 1; index < section.lines.length; index += 1) {
      pairCount += 1;
      if (rhymes(section.lines[index - 1], section.lines[index])) rhymingPairs += 1;
    }
  }
  const rhymeDensity = pairCount === 0 ? 0 : round(rhymingPairs / pairCount, 3);

  // A section repeating its own line is a generation fault. Two exclusions keep
  // the metric honest: chorus repeats *across* sections are intentional (counting
  // per section handles that), and a section whose first and last lines match is
  // the deliberate closing-chorus bookend, not a fault.
  let duplicated = 0;
  for (const section of sections) {
    const bookend =
      section.lines.length > 2 && section.lines[0] === section.lines[section.lines.length - 1];
    const countable = bookend ? section.lines.slice(1, -1) : section.lines;
    const seen = new Set<string>();
    for (const line of countable) {
      const key = line.toLowerCase().replace(/[()]/g, '').trim();
      if (seen.has(key)) duplicated += 1;
      seen.add(key);
    }
  }
  const repetition = round(duplicated / metrics.length, 3);

  const letters = countMatches(lyrics, LETTER);
  const expected =
    script === 'japanese'
      ? countMatches(lyrics, SCRIPT_PATTERNS.japanese)
      : countMatches(lyrics, SCRIPT_PATTERNS[script]);
  // Clamped: the two patterns are counted on the same string, but a ratio above 1
  // is never meaningful and would silently hide a counting mistake.
  const scriptConsistency = letters === 0 ? 1 : Math.min(1, round(expected / letters, 3));
  const detectedScript = detectScript(lyrics);

  // Cliches are language-specific, so look them up under the pack's base code.
  const clicheBank = CLICHES[language.split('-')[0]] ?? [];
  const lowered = lyrics.toLowerCase();
  const cliches = clicheBank.filter((cliche) => lowered.includes(cliche));

  const issues: string[] = [];
  const overlong = metrics.filter((metric) => metric.syllables > highEnd);
  if (overlong.length > 0) {
    issues.push(
      `${overlong.length} line(s) too long for ${bpm} BPM ${timeSignature} (target ~${target} syllables): ` +
        `"${overlong[0].line}" has ~${overlong[0].syllables}`,
    );
  }
  const tooShort = metrics.filter((metric) => metric.syllables < lowEnd);
  if (tooShort.length > 0) {
    issues.push(`${tooShort.length} line(s) below the comfortable range (target ~${target} syllables)`);
  }
  if (scriptConsistency < 0.9) {
    issues.push(
      `${Math.round((1 - scriptConsistency) * 100)}% of letters are outside ${script} script ` +
        `(detected: ${detectedScript})`,
    );
  }
  if (repetition > 0) issues.push(`${duplicated} line(s) repeated inside their own section`);
  if (cliches.length > 0) issues.push(`borrowed cliche(s): ${cliches.join(', ')}`);

  const score = round(
    clamp(
      0.35 * meterFit +
        0.2 * scriptConsistency +
        0.2 * rhymeDensity +
        0.15 * (1 - repetition) +
        0.1 * (1 - Math.min(1, cliches.length / 2)),
      0,
      1,
    ),
    3,
  );

  return {
    language,
    script,
    detectedScript,
    lineCount: metrics.length,
    targetSyllables: target,
    syllableRange: {
      min: Math.min(...syllables),
      median: round(median(syllables), 1),
      max: Math.max(...syllables),
    },
    meterFit,
    rhymeDensity,
    repetition,
    scriptConsistency,
    cliches,
    issues,
    score,
    lines: metrics,
  };
}