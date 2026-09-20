/**
 * Style prompt and title composition.
 *
 * The style string is the single most important input to ACE-Step, so it is built
 * from explicit, layered evidence rather than one genre word: genre intent,
 * instrumentation, mood, local flavour, tempo and vocal delivery.
 */
import { pickWeighted } from '../lib/util.js';
import { genreStyle, GENRE_STYLE } from './genreStyle.js';
import type { MarketFlavor } from './marketFlavor.js';

export interface StylePromptInput {
  genres: string[];
  bpm: number;
  durationSeconds: number;
  flavor: MarketFlavor;
  language: string;
  instrumental: boolean;
  /** Tags earned by previous scoring cycles for this market. */
  learnedTags?: string[];
  /** Production intent the writing style implies (a breakdown and return, a spoken intro). */
  styleHints?: string[];
  rng: () => number;
}

const TEMPO_WORDS: Array<[string, (bpm: number) => boolean]> = [
  ['slow ballad tempo', (bpm) => bpm < 80],
  ['laid-back groove', (bpm) => bpm >= 80 && bpm < 95],
  ['mid-tempo pocket', (bpm) => bpm >= 95 && bpm < 110],
  ['steady dance tempo', (bpm) => bpm >= 110 && bpm < 125],
  ['up-tempo drive', (bpm) => bpm >= 125 && bpm < 140],
  ['fast high-energy feel', (bpm) => bpm >= 140],
];

export function tempoWord(bpm: number): string {
  const match = TEMPO_WORDS.find(([, test]) => test(bpm));
  return match ? match[0] : 'mid-tempo pocket';
}

function sample<T>(items: T[], count: number, rng: () => number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(rng() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

export function composeStylePrompt(input: StylePromptInput): string {
  const [primary, secondary] = input.genres;
  const primaryStyle = genreStyle(primary ?? 'other');
  const parts: string[] = [];

  // Genre intent first - ACE-Step weights the opening terms most heavily.
  parts.push(...primaryStyle.tags.slice(0, 3));
  if (secondary && secondary !== primary) {
    const secondaryStyle = genreStyle(secondary);
    parts.push(...secondaryStyle.tags.slice(0, 1));
    parts.push(...sample(secondaryStyle.instruments, 1, input.rng));
  }

  parts.push(...sample(primaryStyle.instruments, 2, input.rng));
  parts.push(...sample(primaryStyle.mood, 1, input.rng));
  parts.push(...sample(input.flavor.flavorTags, 2, input.rng));

  if (input.learnedTags && input.learnedTags.length > 0) {
    parts.push(...sample(input.learnedTags, Math.min(2, input.learnedTags.length), input.rng));
  }

  // The arrangement the words were written for: a style that breaks the groove and returns
  // needs the engine to be asked for that, or the words and the music disagree.
  if (input.styleHints && input.styleHints.length > 0) {
    parts.push(...sample(input.styleHints, Math.min(1, input.styleHints.length), input.rng));
  }

  parts.push(tempoWord(input.bpm));
  parts.push(`${input.bpm} bpm`);

  if (input.instrumental) {
    parts.push('instrumental, no vocals');
  } else {
    parts.push(input.flavor.vocalNotes);
    if (input.language !== 'en') parts.push(`${input.language} language vocals`);
  }

  // De-duplicate while preserving order, cap length to keep the prompt focused.
  const unique: string[] = [];
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    if (!unique.includes(part)) unique.push(part);
  }
  return unique.join(', ');
}

/** All tag vocabulary available for a genre set (used by the learning loop). */
export function tagVocabulary(genres: string[]): string[] {
  const tags = new Set<string>();
  for (const genre of genres) {
    for (const tag of genreStyle(genre).tags) tags.add(tag);
    for (const tag of genreStyle(genre).instruments) tags.add(tag);
  }
  return Array.from(tags);
}

const TITLE_NOUNS = [
  'Signal', 'Static', 'Neon', 'Midnight', 'Golden', 'Paper', 'Rolling', 'Bright',
  'Silver', 'Hollow', 'Velvet', 'Distant', 'Slow', 'Electric',
];
const TITLE_FORMS = [
  'Hour', 'Lights', 'Road', 'Weather', 'Fever', 'Motion', 'Season', 'Side',
  'Hours', 'Rivers', 'Mornings', 'Echo', 'Horizon', 'Company',
];

export function chooseTitle(input: {
  themes: string[];
  terms: string[];
  used: string[];
  rng: () => number;
}): string {
  const usedSet = new Set(input.used.map((t) => t.toLowerCase()));
  const candidates: string[] = [];

  for (const theme of input.themes) {
    const words = theme.split(' ').filter((w) => w.length > 3);
    if (words.length >= 2) candidates.push(words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' '));
  }
  for (const term of input.terms) {
    if (term.length > 4) {
      const noun = pickWeighted<string | undefined>(TITLE_NOUNS.map((n) => [n, 1]), input.rng) ?? 'Signal';
      candidates.push(`${noun} ${term[0].toUpperCase()}${term.slice(1)}`);
      break;
    }
  }
  for (const noun of TITLE_NOUNS) {
    for (const form of TITLE_FORMS) candidates.push(`${noun} ${form}`);
  }

  const fresh = candidates.filter((c) => c.length >= 4 && !usedSet.has(c.toLowerCase()));
  const pool = fresh.length > 0 ? fresh : candidates;
  return pickWeighted(pool.map((c) => [c, 1] as [string, number]), input.rng) ?? `Untitled ${Date.now()}`;
}

/** Human-readable explanation of why a design looks the way it does. */
export function buildRationale(input: {
  market: string;
  primaryGenre: string;
  genreShare: number;
  bpm: number;
  tempoSource: string;
  flavorTags: string[];
  momentumNew: number;
  keyScale: string;
  learnedNotes: string[];
  /** One-line description of the lyric engine that ran (the arc, or any other style). */
  engineSummary?: string;
}): string {
  const bits = [
    `${input.market} chart skews ${input.primaryGenre} (${Math.round(input.genreShare * 100)}% of weighted chart share)`,
    `tempo target ${input.bpm} BPM from ${input.tempoSource} profile`,
    `key ${input.keyScale}`,
    `local flavour: ${input.flavorTags.slice(0, 2).join(', ') || 'baseline'}`,
    `${input.momentumNew} new chart entries this snapshot`,
  ];
  if (input.learnedNotes.length > 0) bits.push(`learned: ${input.learnedNotes.join('; ')}`);
  if (input.engineSummary) bits.push(`lyric engine: ${input.engineSummary}`);
  return bits.join('; ');
}

export { GENRE_STYLE };