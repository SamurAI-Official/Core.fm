/**
 * Learning from preference: the weights a dislike and a like move, and by how much.
 *
 * The first version of this learned from a 0..1 rating alone and updated genre, tempo, key and
 * production tags. Two things were missing once there was a dislike button:
 *
 *   1. **A dislike is not a low score.** A rating of 0.2 says "not a hit"; a thumbs-down says "do
 *      not do this again", and the two should not move a weight by the same amount. A dislike takes
 *      a full-size negative step regardless of any score alongside it.
 *   2. **The lyric side was learnable in principle and never learned.** Genre, tempo, key and tags
 *      moved; the writing style, the subject, the language and the chart themes - the choices that
 *      decide what a song actually says - were recorded on every concept and never fed back. They
 *      are keys here now, and the designer reads them (`agent:`, `subject:`, `language:`).
 *
 * Reasons sharpen the credit assignment rather than being decoration: "muddy mix" moves only the
 * production tags, "bad lyrics" moves the writing style and subject, "wrong genre" moves the genre.
 * Without a reason every feature the song carried moves, which is the blunt version and the reason
 * `feedback.reasons` exists at all.
 */
import { config } from '../config.js';
import { clamp, round } from '../lib/util.js';
import { tempoClass } from '../analysis/tempo.js';
import { tagVocabulary } from '../design/prompt.js';
import { getWeight, setWeight } from '../loops/ratings.js';

/** The parts of an output a preference can be attributed to. */
export interface FeedbackFeatures {
  genre?: string;
  bpm?: number;
  keyScale?: string;
  /** The style prompt, used to find the production tags it actually contains. */
  style?: string;
  /** Writing style id (`params.lyricAgent`). */
  agent?: string;
  /** Subject id (`params.lyricSubject`). */
  subject?: string;
  /** Vocal language (`params.lyricLanguage`). */
  language?: string;
  /** The themes the lyric was written against (`params.lyricThemes`). */
  themes?: string[];
}

export type FeedbackVerdict = 'like' | 'dislike';

export interface LearnInput {
  market?: string;
  verdict: FeedbackVerdict;
  /** Optional 0..1 alongside the verdict; a dislike ignores it for sizing. */
  score?: number;
  /** Free-form reason ids: mix | genre | lyrics | tempo | language | repetition. */
  reasons?: string[];
  features: FeedbackFeatures;
}

/** Which key families a reason blames. Absent reasons blame everything the song carried. */
const REASON_KEYS: Record<string, string[]> = {
  // Production: the mix, the vocal, artefacts. All carried by the style prompt's tags.
  mix: ['tag'],
  production: ['tag'],
  muddy: ['tag'],
  artifacts: ['tag'],
  vocals: ['tag'],
  // What the song is.
  genre: ['genre'],
  'wrong-genre': ['genre'],
  tempo: ['bpm'],
  key: ['key'],
  lyrics: ['agent', 'subject'],
  'bad-lyrics': ['agent', 'subject'],
  repetition: ['agent', 'subject'],
  language: ['language', 'subject'],
  pronunciation: ['language'],
  /**
   * "Not what I asked for" judges the mapping from the prompt to the song, which is carried by the
   * genre that was picked, the themes the subject was matched from, and the tags the style prompt
   * named - so those are what it moves. It is the one reason that is about the *translation* of an
   * instruction rather than about the music.
   */
  'off-prompt': ['genre', 'subject', 'tag'],
  /**
   * "Just not for me" names nothing, and is deliberately mapped to nothing: it must blame everything
   * the response carried rather than pretend to be a specific complaint. The same fallback catches a
   * reason nobody has modelled yet (see below), which is why the empty list matters.
   */
  'not-my-kind': [],
};

/**
 * How hard a verdict moves the weights.
 *
 * A dislike is deliberately larger than a bad rating: `learningRate` (0.25) is the size of "a full
 * opinion", a dislike takes all of it, and a score takes its distance from neutral.
 */
const DISLIKE_STEPS = 1;
const LIKE_BASE = 0.85;

export function learnFromFeedback(input: LearnInput): string[] {
  if (!input.market) return [];
  const reasons = (input.reasons ?? []).map((reason) => reason.toLowerCase()).filter(Boolean);
  // A reason nobody has modelled must never silently move nothing: the complaint would be recorded,
  // the weights would not change, and nothing in the response would say so. So a reason set that
  // blames no family at all is treated as unattributed - it blames everything the response carried -
  // and the unrecognised ids are reported back to the caller.
  const mapped = reasons.flatMap((reason) => REASON_KEYS[reason] ?? []);
  const unrecognised = reasons.filter((reason) => !(reason in REASON_KEYS));
  const blamed = reasons.length > 0 && mapped.length > 0 ? new Set(mapped) : null;
  const blames = (family: string): boolean => blamed === null || blamed.has(family);

  const delta =
    input.verdict === 'dislike'
      ? -config.scoring.learningRate * DISLIKE_STEPS
      : config.scoring.learningRate * (clamp(input.score ?? LIKE_BASE) - 0.5);
  if (delta === 0) return [];

  const applied: string[] = [];
  const bump = (key: string, share: number): void => {
    const amount = delta * share;
    if (amount === 0) return;
    const current = getWeight(input.market as string, key, 1);
    const next = clamp(current + amount, 0.25, 3);
    setWeight(input.market as string, key, round(next, 4));
    applied.push(`${key} -> ${round(next, 3)}`);
  };

  const features = input.features;
  if (unrecognised.length > 0) {
    applied.push(
      `unrecognised reason(s) ${unrecognised.join(', ')}: blamed everything the response carried`,
    );
  }
  if (features.genre && blames('genre')) bump(`genre:${features.genre}`, 1);
  if (features.bpm && blames('bpm')) bump(`bpm:${tempoClass(features.bpm)}`, 0.6);
  if (features.keyScale && blames('key')) bump(`key:${features.keyScale}`, 0.5);

  // Production tags: from the style prompt when there is one, else the declared tags.
  if (blames('tag')) {
    const style = (features.style ?? '').toLowerCase();
    for (const tag of tagVocabulary(features.genre ? [features.genre] : [])) {
      if (style.includes(tag.toLowerCase())) bump(`tag:${tag}`, 0.4);
    }
  }

  // The lyric-side keys. The designer reads agent: and subject: (and language:), so a dislike on a
  // writing style is what stops that style being chosen for that market next cycle.
  if (features.agent && blames('agent')) bump(`agent:${features.agent}`, 1);
  if (features.subject && blames('subject')) bump(`subject:${features.subject}`, 0.6);
  if (features.language && blames('language')) bump(`language:${features.language}`, 0.8);
  // Themes ride with the subject: they are how the subject was matched, so a complaint about the
  // lyrics or the language reaches them, and a complaint about the mix does not.
  if (blames('subject')) {
    for (const theme of (features.themes ?? []).slice(0, 3)) {
      bump(`theme:${theme.toLowerCase()}`, 0.3);
    }
  }

  return applied;
}
