/**
 * Language packs: the unit of lyric correctness.
 *
 * The previous design kept English templates in one place and English banks in
 * another, with a `language` string threaded through that only *labelled* the
 * output. That is how the pipeline ended up sending English words to the engine
 * tagged `vocal_language=ja`: nothing in the writing path could actually produce
 * Japanese, and nothing stopped it from claiming it had.
 *
 * A pack therefore owns its own banks *and* its own stage renderers. Grammar is
 * not abstracted behind shared templates, because it cannot be: French needs
 * elision and gender agreement, German puts the verb at the end of a subordinate
 * clause, Japanese needs particles and no plural agreement at all. A pack is the
 * smallest thing that can be verified by someone who speaks the language.
 */
import type { LyricStage } from '../arc.js';

/** Everything a stage needs in order to render its lines. */
export interface LyricContext {
  rng: () => number;
  /** The chorus hook, already built by the pack and guaranteed grammatical. */
  hook: string;
  /** Opposing verb phrases for the contradiction stage. */
  contradiction: [string, string];
  /** Opposing qualities for the contradiction stage's second line. */
  contrast: [string, string];
  /** The physical object chosen for the concrete-metaphor stage. */
  metaphor: string;
  /** Wider subject or, where the language requires it, a full already-agreeing
   * clause (gendered languages cannot compose adjective + noun at runtime). */
  wideSubject: string;
  wideVerb: string;
  conclusion: 'unresolved' | 'reframed';
  qualifier: string;
  /** A topical word from the market's chart, used only as an ad-lib. */
  topicWord?: string;
}

/**
 * Renders the lines for one arc stage.
 * `used` carries lines already emitted in this section so a stage cannot repeat
 * itself; the renderer may return fewer lines than `count` when its banks run dry.
 */
export type StageRenderer = (count: number, ctx: LyricContext, used: Set<string>) => string[];

/**
 * Script family. Lives in `lib/text.ts` so the trend pipeline and the lyric
 * validator share one definition. Imported for local use and re-exported so pack
 * authors can import it alongside `LanguagePack`.
 */
import type { ScriptFamily } from '../../lib/text.js';

export type { ScriptFamily };

export interface LanguagePack {
  /** Language code used for the engine's `vocal_language`. */
  code: string;
  /** English label for logs, rationale and the UI. */
  label: string;
  /** Endonym, so the UI can show the language in its own script. */
  nativeLabel: string;
  script: ScriptFamily;
  /** False while a pack is a stub and must not be chosen as a real target. */
  complete: boolean;

  /** Builds the hook (subject + verb), agreeing in this language's grammar. */
  buildHook(rng: () => number): string;
  /** Picks the scale-expansion subject together with its correctly agreed verb. */
  buildScale(rng: () => number): { subject: string; verb: string };
  pickContradiction(rng: () => number): [string, string];
  pickContrast(rng: () => number): [string, string];
  pickQualifier(rng: () => number): string;
  /** Intro ad-lib: a short, self-contained fragment (often the hook). */
  introLine(ctx: LyricContext): string;
  /** Applies the closing reframe so the song ends unresolved rather than resolved. */
  reframe(hook: string, qualifier: string): string;

  /**
   * Metaphor objects for the concrete-metaphor stage, in this language.
   *
   * `family` is the genre/register family name from imagery.ts. Packs map families
   * onto their own pools as they see fit, but must always return phrases in the
   * target language - the English imagery bank leaking into a French song was the
   * same class of bug as English words being tagged as Japanese.
   */
  metaphors(family: string): string[];

  render: Record<LyricStage, StageRenderer>;
}

/** Picks a random entry, ignoring `used` when the bank is exhausted. */
export function fromBank(rng: () => number, bank: string[], used?: Set<string>): string {
  const pool = used ? bank.filter((entry) => !used.has(entry)) : bank;
  const source = pool.length > 0 ? pool : bank;
  return source[Math.floor(rng() * source.length)] ?? bank[0] ?? '';
}

/** Picks a pair, avoiding pairs whose halves were already used in this section. */
export function pairFromBank(
  rng: () => number,
  bank: Array<[string, string]>,
  used: Set<string>,
): [string, string] {
  const pool = bank.filter(([a, b]) => !used.has(a) && !used.has(b));
  const source = pool.length > 0 ? pool : bank;
  const entry = source[Math.floor(rng() * source.length)] ?? bank[0];
  return [entry[0], entry[1]];
}

/** Capitalises the first character (safe for non-Latin scripts: no-op there). */
export function sentenceCase(input: string): string {
  return input.length === 0 ? input : input[0].toUpperCase() + input.slice(1);
}

/** Trims a generated line list to the section's line budget. */
export function takeLines(lines: string[], count: number): string[] {
  return lines.slice(0, Math.max(1, Math.min(count, lines.length)));
}