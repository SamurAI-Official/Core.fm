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
  mix: ['tag'],
  production: ['tag'],
  genre: ['genre'],
  tempo: ['bpm'],
  key: ['key'],
  lyrics: ['agent', 'subject'],
  repetition: ['agent', 'subject'],
  language: ['language', 'subject'],
  pronunciation: ['language'],
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
  const blamed = reasons.length > 0 ? new Set(reasons.flatMap((reason) => REASON_KEYS[reason] ?? [])) : null;
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
