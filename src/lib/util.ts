/**
 * Small shared helpers. Kept dependency-free so analysis code stays deterministic
 * and easy to test.
 */
import { createHash, randomUUID } from 'crypto';

export const uuid = (): string => randomUUID();

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

export function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function median(values: number[]): number {
  return percentile(values, 50);
}

export function percentile(values: number[], p: number): number {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  if (clean.length === 1) return clean[0];
  const idx = clamp(p / 100, 0, 1) * (clean.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return clean[lower];
  return clean[lower] + (clean[upper] - clean[lower]) * (idx - lower);
}

export function mean(values: number[]): number {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return 0;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

/** Deterministic PRNG so a design run can be replayed from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(input: string): number {
  return parseInt(sha256(input).slice(0, 8), 16);
}

export function pickWeighted<T>(entries: Array<[T, number]>, rng: () => number): T | undefined {
  const total = entries.reduce((sum, [, w]) => sum + Math.max(w, 0), 0);
  if (entries.length === 0 || total <= 0) return undefined;
  let target = rng() * total;
  for (const [item, weight] of entries) {
    target -= Math.max(weight, 0);
    if (target <= 0) return item;
  }
  return entries[entries.length - 1][0];
}

/**
 * Extracts usable content words from a title/artist string.
 *
 * Chart titles contain acronyms, brands and numbered names ("GTAVI", "Track 2"),
 * which read as nonsense when injected into lyrics. This keeps only
 * word-like tokens: 4+ letters, contains a vowel, not an acronym, no digits.
 */
export function contentTokens(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[^A-Za-z0-9']+/)) {
    if (part.length < 4 || part.length > 18) continue;
    if (/^[A-Z0-9]{3,}$/.test(part)) continue; // acronym / brand styling
    if (/\d/.test(part)) continue; // years and numbered titles
    const lower = part.toLowerCase();
    if (!/[aeiou]/.test(lower)) continue;
    if (STOP_WORDS.has(lower)) continue;
    out.push(lower);
  }
  return out;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'feat', 'ft',
  'from', 'de', 'la', 'el', 'le', 'les', 'los', 'las', 'und', 'y', 'e', 'no', 'my',
  'your', 'you', 'me', 'it', 'is', 'be', 'at', 'by', 'as', 'that', 'this', 'i', 'we',
]);

/** Normalized token list used for theme extraction and similarity checks. */
export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/** Jaccard similarity over token sets - used for novelty/artist-overlap checks. */
export function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function normalizeDistribution(counts: Record<string, number>): Record<string, number> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) out[key] = round(value / total, 4);
  return out;
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalizes one half of a track key.
 *
 * Diacritics are stripped so "Beyoncé" and "Beyonce" collapse, full-width forms
 * are folded to half-width (NFKD) so Japanese titles match across sources, and
 * every non-letter/digit run becomes a single space so punctuation differences
 * ("Song (feat. X)" vs "Song") do not split the same track. Unicode-aware
 * classes are required here: Cyrillic/CJK titles must survive intact.
 */
function normalizeKeyPart(input?: string | null): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\((?:feat|ft|with)[^)]*\)/g, ' ')
    .replace(/\[(?:feat|ft|with)[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Stable identity for a track across sources and collection runs, used to build
 * per-track rank time series. Same title by different artists stays distinct;
 * the same track re-titled by a source still collides only when artist+title
 * both normalize to the same value.
 */
export function trackKey(title: string, artist?: string | null): string {
  return `${normalizeKeyPart(artist)}::${normalizeKeyPart(title)}`;
}

/**
 * Days between two ISO timestamps (fractional). Used to convert rank movement
 * into a per-day velocity so observations spaced unevenly stay comparable.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso.includes('T') ? fromIso : fromIso.replace(' ', 'T') + 'Z');
  const to = Date.parse(toIso.includes('T') ? toIso : toIso.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return (to - from) / 86_400_000;
}