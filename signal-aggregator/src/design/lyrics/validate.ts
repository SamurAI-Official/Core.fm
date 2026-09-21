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
import { detectScript, scriptShare, type ScriptFamily } from '../../lib/text.js';

/** Re-exported so existing callers keep working; implementation is in `lib/text.ts`. */
export { detectScript };

export interface LineMetric {
  section: string;
  line: string;
  syllables: number;
  /**
   * Whitespace-delimited words. Not meaningful for no-space scripts (zh, ja), where
   * a whole line is a single "word" - reported for diagnostics only and never used
   * in scoring.
   */
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
  /** Share of lines duplicated inside their own section (0 when repetition is the device). */
  repetition: number;
  /**
   * Lines repeated inside their own section, counted regardless of policy.
   *
   * This is the informational number: a refrain song reports `repetition: 0` because the
   * repeat is the technique rather than a defect, and this field still says how many
   * repeats it used.
   */
  repeatedLines: number;
  /**
   * How many times the most-sung line is sung across the *whole* song.
   *
   * `repetition` above counts duplicates inside one section, which is where a defect
   * usually hides - but it cannot see a hook sung once in each of seven sections, so a
   * style can reach half a song being a single line while reporting no repetition at all.
   * This measures that directly, for every policy, because it is a fact about the song
   * rather than a verdict on it.
   */
  maxLineRepeats: number;
  /** Share of sung lines taken by that line. */
  maxLineShare: number;
  /** Distinct lines as a share of sung lines - the other side of the same measurement. */
  distinctLineShare: number;
  /** The most-sung line itself, for a failure message or the UI. */
  mostSungLine: string;
  /** Share of characters written in the expected script. */
  scriptConsistency: number;
  cliches: string[];
  issues: string[];
  score: number;
  lines: LineMetric[];
}

/**
 * Small kana attach to the preceding mora and add none of their own.
 *
 * Script detection and the shared script patterns live in `lib/text.ts` so the
 * trend pipeline and the validator cannot drift apart on what counts as Cyrillic.
 */
const SMALL_KANA = /[\u3041\u3043\u3045\u3047\u3049\u3083\u3085\u3087\u30A1\u30A3\u30A5\u30A7\u30A9\u30E3\u30E5\u30E7]/g;

/**
 * Borrowed phrases per language, flagged rather than shipped.
 * Matching is accent- and case-insensitive (see `normalizeForMatch`).
 */
const CLICHES: Record<string, string[]> = {
  en: ['heart of gold', 'dancing in the rain', 'set me free', 'light up the sky', 'break these chains', 'rise above it all'],
  fr: ['au fond de mon coeur', 'danser sous la pluie', 'briser mes chaines', 'voir la lumiere'],
  de: ['im regen tanzen', 'herz aus gold', 'lass mich frei', 'den himmel erleuchten'],
  es: ['corazon de oro', 'bailar bajo la lluvia', 'libre al fin', 'romper las cadenas', 'luz en el cielo'],
  it: ['cuore doro', 'ballare sotto la pioggia', 'liberami', 'spezzare le catene'],
  pt: ['coracao de ouro', 'dancar na chuva', 'me libertar', 'quebrar as correntes'],
  ru: ['сердце из золота', 'танцевать под дождём', 'освободи меня', 'разорвать цепи'],
  ja: ['心のままに', '雨の中で踊る', '自由になれ', '涙のち晴れ'],
  ko: ['황금 같은 마음', '비 속에서 춤추다', '나를 놓아줘', '사슬을 끊어'],
  zh: ['金子般的心', '在雨中跳舞', '让我自由', '打破枷锁'],
};

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/**
 * Case- and accent-insensitive form used for cliche matching.
 * NFKD + combining-mark stripping turns "cœur"/"coeur" and "corazón"/"corazon" into
 * the same string, while CJK passes through untouched.
 */
function normalizeForMatch(input: string): string {
  return input.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
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

/** Vowel letters that each mark a syllable in Cyrillic text (ru, plus uk/be). */
const CYRILLIC_VOWELS = /[\u0430\u0435\u0451\u0438\u043E\u0443\u044B\u044D\u044E\u044F\u0456\u0457\u0454\u0410\u0415\u0401\u0418\u041E\u0423\u042B\u042D\u042E\u042F\u0406\u0407\u0404]/g;

/**
 * Syllable counters, one per script.
 *
 * Every script has an entry deliberately. The previous implementation special-cased
 * Japanese/Devanagari/Hangul/Han and let everything else fall through to the Latin
 * counter - which strips non-Latin characters, so a Russian line measured as **one
 * syllable** and its meter score was meaningless. A missing model now shows up as a
 * visibly coarse estimate instead of a silent zero.
 */
const SYLLABLE_MODELS: Record<ScriptFamily, (text: string) => number> = {
  latin: (text) =>
    text
      .split(/\s+/)
      .filter(Boolean)
      .reduce((sum, word) => sum + latinWordSyllables(word), 0),

  // One syllable per vowel letter.
  cyrillic: (text) => countMatches(text, CYRILLIC_VOWELS),

  // Kana are one mora each (small kana add none, the long-vowel mark adds one);
  // kanji are approximated at one mora, since there is no reading dictionary.
  japanese: (text) =>
    countMatches(text, /[\u3040-\u30FF]/g) -
    countMatches(text, SMALL_KANA) +
    countMatches(text, /[\u4E00-\u9FFF]/g),

  // Each Hangul syllable block is one syllable.
  hangul: (text) => countMatches(text, /[\uAC00-\uD7AF]/g),

  // Mandarin is one syllable per Han character.
  han: (text) => countMatches(text, /[\u4E00-\u9FFF]/g),

  // Base letters only: matras and other combining marks are not syllables.
  devanagari: (text) => countMatches(text, /[\u0900-\u0939\u0958-\u095F\u0960-\u0961]/g),

  // No vowel model implemented; long and short vowels are not distinguished, so
  // letters/2 is a deliberately coarse placeholder. No pack uses this script yet.
  arabic: (text) => countMatches(text, /\p{Script=Arabic}/gu) / 2,
};

/**
 * Estimated syllables (or morae, for Japanese) in one line.
 * Section headers must be stripped by the caller.
 */
export function estimateSyllables(line: string, script: ScriptFamily): number {
  const text = line.replace(/[()]/g, ' ').trim();
  if (!text) return 0;
  const model = SYLLABLE_MODELS[script] ?? SYLLABLE_MODELS.latin;
  return Math.max(1, Math.round(model(text)));
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

/** Tail of a Latin word: final vowel nucleus plus whatever follows it. */
function latinTail(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z\u00e0-\u024f]/g, '');
  const match = w.match(/[aeiouy\u00e0-\u00ff][^aeiouy\u00e0-\u00ff]*$/);
  return match ? match[0] : w.slice(-3);
}

/** Cyrillic vowels, used to find the final nucleus of a Russian/Ukrainian word. */
const CYRILLIC_VOWEL_CLASS = '[\u0430\u0435\u0451\u0438\u043E\u0443\u044B\u044D\u044E\u044F\u0456\u0457\u0454]';

/**
 * A comparable "ending sound" for one word, per script.
 *
 * The Latin implementation strips everything outside `[a-z\u00e0-\u024f]`, which
 * reduced any Cyrillic or Japanese ending to an empty string - so `rhymes()` returned
 * false for every pair and those languages silently lost the 0.2 of the score that
 * rhyme contributes. These keys are approximations and labelled as such: real
 * Mandarin rhyme is a rime-plus-tone system and Japanese assonance is mora-based,
 * neither of which is derivable from orthography alone.
 */
function rhymeKey(word: string, script: ScriptFamily): string {
  switch (script) {
    case 'cyrillic': {
      const w = word.toLowerCase().replace(/[^\u0400-\u04FF]/g, '');
      const match = w.match(new RegExp(`${CYRILLIC_VOWEL_CLASS}[^${CYRILLIC_VOWEL_CLASS.slice(1)}]*$`));
      return match ? match[0] : w.slice(-3);
    }
    case 'japanese': {
      // Mora-based: compare the trailing kana, ignoring small kana and the prolonged
      // sound mark, so "とう" and "とー" still match.
      const meaningful = Array.from(word)
        .filter((ch) => /[\u3040-\u30FF]/.test(ch))
        .filter((ch) => !SMALL_KANA.test(ch) && ch !== '\u30FC');
      return meaningful.slice(-2).join('');
    }
    case 'hangul': {
      // Hangul blocks decompose as 0xAC00 + (initial*21 + medial)*28 + final, so the
      // final vowel and whether a batchim closes the syllable can be read exactly.
      const blocks = Array.from(word).filter((ch) => /[\uAC00-\uD7AF]/.test(ch));
      const last = blocks[blocks.length - 1];
      if (!last) return '';
      const offset = last.codePointAt(0)! - 0xac00;
      const medial = Math.floor(offset / 28) % 21;
      return `${medial}${offset % 28 === 0 ? 'v' : 'c'}`;
    }
    case 'han': {
      // Final character only - see the note above on Mandarin rime and tone.
      const chars = Array.from(word).filter((ch) => /\p{Script=Han}/u.test(ch));
      return chars.slice(-1).join('');
    }
    case 'devanagari':
    case 'arabic':
      return Array.from(word).slice(-2).join('');
    default:
      return latinTail(word);
  }
}

/**
 * Minimum key width that may count as a rhyme.
 * Latin and Cyrillic need a real tail ("ay" alone would match half the language);
 * CJK keys are inherently one or two units wide.
 */
function minRhymeKeyLength(script: ScriptFamily): number {
  return script === 'latin' || script === 'cyrillic' ? 2 : 1;
}

/** True when two line endings share a sound, i.e. rhyme or assonance. */
function rhymes(a: string, b: string, script: ScriptFamily): boolean {
  const lastOf = (line: string) =>
    line.replace(/[()]/g, ' ').trim().split(/\s+/).filter(Boolean).pop() ?? '';
  const keyA = rhymeKey(lastOf(a), script);
  const keyB = rhymeKey(lastOf(b), script);
  if (!keyA || !keyB) return false;
  const minLength = minRhymeKeyLength(script);
  if (keyA.length < minLength || keyB.length < minLength) return false;
  return keyA === keyB;
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

/**
 * Sections of a lyric, headers removed.
 *
 * Exported so the writing-style gate and the inspection scripts read a generated song the
 * same way the validator does - a second parser in `scripts/` would be a second definition
 * of where a section ends, and the two would drift.
 */
export interface LyricSection {
  name: string;
  lines: string[];
}

export function sectionMap(lyrics: string): LyricSection[] {
  return parseSections(lyrics).map((section) => ({ name: section.name, lines: section.lines }));
}

/** Just the sung lines, headers stripped, one per line. */
export function plainText(lyrics: string): string {
  return parseSections(lyrics)
    .flatMap((section) => section.lines)
    .join('\n');
}

export interface ValidateOptions {
  language: string;
  script: ScriptFamily;
  bpm: number;
  timeSignature: string;
  barsPerLine?: number;
  /**
   * Whether a line repeated inside its own section is a fault (`fault`, the default) or
   * the technique the song is built on (`device` - a refrain, a call and response, a
   * circular return). The count is measured either way and reported in `repeatedLines`;
   * only the *fault* interpretation changes, and a gate asserts that a device style really
   * did repeat something rather than being let off.
   */
  repetitionPolicy?: 'fault' | 'device';
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
      repeatedLines: 0,
      maxLineRepeats: 0,
      maxLineShare: 0,
      distinctLineShare: 0,
      mostSungLine: '',
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
      if (rhymes(section.lines[index - 1], section.lines[index], script)) rhymingPairs += 1;
    }
  }
  const rhymeDensity = pairCount === 0 ? 0 : round(rhymingPairs / pairCount, 3);

  // A section repeating its own line is a generation fault - unless the style repeats on
  // purpose. The count is always measured; the policy only decides whether it costs score.
  // Two exclusions keep the measurement honest: chorus repeats *across* sections are
  // intentional (counting per section handles that), and a section whose first and last
  // lines match is the deliberate closing bookend, not a fault.
  const repetitionPolicy = options.repetitionPolicy ?? 'fault';
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
  const repeatedLines = duplicated;
  const repetition = repetitionPolicy === 'device' ? 0 : round(duplicated / metrics.length, 3);

  // The same question asked of the whole song rather than of one section. Sameness is judged as
  // the writer and the per-section pass judge it (lower-cased, parentheses removed), so a line and
  // its parenthesised backing-vocal echo count as one line here as well.
  const wholeSong = new Map<string, number>();
  const keyOf = (line: string): string => line.toLowerCase().replace(/[()]/g, '').trim();
  for (const metric of metrics) {
    const key = keyOf(metric.line);
    wholeSong.set(key, (wholeSong.get(key) ?? 0) + 1);
  }
  let maxLineRepeats = 0;
  let mostSungLine = '';
  for (const metric of metrics) {
    const count = wholeSong.get(keyOf(metric.line)) ?? 0;
    if (count > maxLineRepeats) {
      maxLineRepeats = count;
      mostSungLine = metric.line;
    }
  }
  const maxLineShare = metrics.length > 0 ? round(maxLineRepeats / metrics.length, 3) : 0;
  const distinctLineShare = metrics.length > 0 ? round(wholeSong.size / metrics.length, 3) : 0;

  // Measured over lyric lines only. Section headers ("[Verse 1]", "[Chorus]") are
  // engine control tokens, not sung text - counting them cost every non-Latin
  // language ~15% of its script score and raised a spurious "letters outside script"
  // warning on every Japanese, Chinese, Russian and Korean concept.
  const body = sections.flatMap((entry) => entry.lines).join(' ');
  const scriptConsistency = round(scriptShare(body, script), 3);
  const detectedScript = detectScript(body);

  // Cliches are language-specific, so look them up under the pack's base code, and
  // compare accent-insensitively so "corazón" and "corazon" both match.
  const clicheBank = CLICHES[language.split('-')[0]] ?? [];
  const normalizedLyrics = normalizeForMatch(body);
  const cliches = clicheBank.filter((cliche) => normalizedLyrics.includes(normalizeForMatch(cliche)));

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
    repeatedLines,
    maxLineRepeats,
    maxLineShare,
    distinctLineShare,
    mostSungLine,
    scriptConsistency,
    cliches,
    issues,
    score,
    lines: metrics,
  };
}