/**
 * Language pack registry.
 *
 * A requested language that has no pack is a *reported* fallback, never a silent
 * one. This is the core correction: previously a concept for the Japanese market
 * carried `vocal_language: 'ja'` while its lyrics were English, so the engine was
 * asked to sing English words as Japanese and nothing in the pipeline noticed.
 */
import { englishPack } from './en.js';
import { frenchPack } from './fr.js';
import { germanPack } from './de.js';
import { spanishPack } from './es.js';
import { italianPack } from './it.js';
import { portuguesePack } from './pt.js';
import type { LanguagePack } from './types.js';

const PACKS: Record<string, LanguagePack> = {
  en: englishPack,
  fr: frenchPack,
  de: germanPack,
  es: spanishPack,
  it: italianPack,
  pt: portuguesePack,
};

/**
 * Languages we know we have not written yet. Used only to produce a more useful
 * message than "unknown language" - the mechanism is identical either way.
 */
const PENDING = new Set([
  'ja', 'ko', 'zh', 'ru', 'hi', 'nl', 'uk', 'ar', 'tr', 'id', 'ms',
  'th', 'vi', 'tl', 'sv', 'no', 'da', 'fi', 'pl', 'el', 'ur', 'he', 'sw', 'yo', 'ig', 'zu',
]);

export interface PackResolution {
  /** The pack whose grammar actually wrote the lyrics. */
  pack: LanguagePack;
  /** The language that was asked for (normalized). */
  requested: string;
  /** True when `requested` was not available and another pack wrote the lyrics. */
  fallback: boolean;
  reason?: string;
}

/** Normalizes "pt-BR" / "FR" / "de-AT" into a lookup code. */
function normalizeCode(code: string): string {
  return code.trim().toLowerCase().replace('_', '-');
}

/**
 * Resolves the pack that should write a market's lyrics.
 *
 * A regional variant falls back to its base language ("de-AT" -> "de") because the
 * grammar is shared; only the vocabulary would differ.
 */
export function resolvePack(requested: string): PackResolution {
  const normalized = normalizeCode(requested || 'en');
  const direct = PACKS[normalized];
  if (direct) return { pack: direct, requested: normalized, fallback: false };

  const base = normalized.split('-')[0];
  const basePack = PACKS[base];
  if (basePack) return { pack: basePack, requested: normalized, fallback: false };

  return {
    pack: englishPack,
    requested: normalized,
    fallback: true,
    reason: PENDING.has(base)
      ? `no ${normalized} lyric pack yet (writing is English-only for now)`
      : `unsupported language '${normalized}'`,
  };
}

/** Codes with a real pack, for docs, the UI and the design rationale. */
export function availableLanguages(): Array<{
  code: string;
  label: string;
  nativeLabel: string;
  reviewStatus: 'unreviewed' | 'native-reviewed';
}> {
  return Object.values(PACKS).map((pack) => ({
    code: pack.code,
    label: pack.label,
    nativeLabel: pack.nativeLabel,
    // Defaults to 'unreviewed': no pack has had a native-speaker pass, and saying so
    // is the honest position - a test can prove grammar, not naturalness.
    reviewStatus: pack.reviewStatus ?? 'unreviewed',
  }));
}

export function isPendingLanguage(code: string): boolean {
  return PENDING.has(normalizeCode(code).split('-')[0]);
}

export type { LanguagePack };