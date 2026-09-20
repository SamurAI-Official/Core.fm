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
import type { PrimitiveId } from './primitives.js';
import { estimateSyllables } from './validate.js';

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
  /**
   * What this song is about (an id from `subjects.ts`).
   *
   * Chosen per concept - partly from the market's own chart words and themes - so the
   * writer is not locked to one story across every market, genre and language. The
   * pack decides where the subject shows up in its own grammar; see `SubjectTable`.
   */
  subject: string;
  /** English label for `subject`, for the rationale, the UI and logs. */
  subjectLabel: string;
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
  /**
   * Whether a native speaker has reviewed this pack's output.
   *
   * Every pack is machine-written and therefore starts 'unreviewed'. The field exists
   * so the app, the rationale and the docs never imply a review that has not
   * happened - grammatical correctness is verifiable by test, naturalness is not.
   */
  reviewStatus?: 'unreviewed' | 'native-reviewed';

  /**
   * Subject ids (see `subjects.ts`) this pack writes natively.
   *
   * The orchestrator only chooses from this list, so a concept is never labelled
   * with a subject the pack can only fall back on. Absent or empty means "general
   * material only": the catalog is still drawn from, but the plan records
   * `subjectRealised: false` so the limitation is visible rather than implied.
   */
  subjectCoverage?: string[];

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
   * Whole-line primitives a writing agent may place freely (see `primitives.ts`).
   *
   * `render` gives lines for templates this pack owns, so a bank entry only has to be
   * right inside its one slot. An agent chooses the order of a primitive, so a primitive
   * entry must read correctly **standing alone**. Coverage is derived from the table: a
   * primitive exists when it has entries, and an agent that needs one this pack lacks is
   * simply never chosen for it.
   */
  primitives?: Partial<Record<PrimitiveId, string[]>>;

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

/**
 * Reframing with a length ceiling.
 *
 * "`hook, qualifier`" is the reframe every pack wants, but the result has to be *singable*: the
 * comfortable band tops out around twelve syllables at 110-120 BPM, and a hook plus a qualifier
 * runs past that in the longer-syllable languages. When it does, the qualifier carries the reframe
 * on its own - it still turns the hook against itself.
 *
 * It must not fall back to the hook: a "reframed" conclusion that is word-for-word the hook is not
 * a reframe, and the first version of this did exactly that, which the gate caught as a repeated
 * line in every style that puts the hook and the closing line in one section.
 *
 * This lives here rather than in each pack because the rule is the same everywhere; what differs
 * per language is the script it is measured in.
 */
export function boundedReframe(
  script: ScriptFamily,
  maxSyllables = 12,
  joiner = ', ',
): (hook: string, qualifier: string) => string {
  return (hook, qualifier) => {
    const combined = `${hook}${joiner}${qualifier}`;
    return estimateSyllables(combined, script) <= maxSyllables ? combined : qualifier;
  };
}

/**
 * A pack's material for one subject.
 *
 * `adlib` is a short, self-contained fragment (a noun phrase or a short clause) used
 * for the intro, and `banks` adds subject-specific lines per arc stage. Any stage a
 * subject does not cover falls back to the pack's general bank, so partial coverage
 * is safe by construction - a pack can add one subject at a time without any stage
 * ever being able to render empty.
 */
export interface SubjectMaterial {
  /** Intro ad-lib in this language. Must read correctly standing alone. */
  adlib: string;
  /**
   * Optional replacement for the pack's self-description bank ("I'm ...").
   *
   * This is the only extra slot because it is the one every pack already has and the
   * one that lands inside a two-line section budget: without it, a subject can be
   * missing from a verse whose stage budget only reaches the first two lines.
   */
  selves?: string[];
  /** Subject-specific stage banks. Missing stages use the general bank. */
  banks?: Partial<Record<LyricStage, string[]>>;
}

/** Subject id -> material, declared by each pack in its own language. */
export type SubjectTable = Record<string, SubjectMaterial>;

/**
 * Bank picker for pack renderers.
 *
 * Grammar stays in the pack: the pack supplies its own subject banks, and this only
 * decides between them and the general bank for the same grammatical slot.
 */
export function bankPicker(table: SubjectTable | undefined) {
  return (ctx: LyricContext, stage: LyricStage, general: string[]): string[] => {
    const entry = table?.[ctx.subject]?.banks?.[stage];
    return entry && entry.length > 0 ? entry : general;
  };
}

/** Intro ad-lib for the current subject, or undefined when the pack has none. */
export function subjectAdlib(table: SubjectTable | undefined, ctx: LyricContext): string | undefined {
  return table?.[ctx.subject]?.adlib;
}

/** Subject-specific self-description bank, or undefined for the pack's general one. */
export function subjectSelves(table: SubjectTable | undefined, ctx: LyricContext): string[] | undefined {
  const selves = table?.[ctx.subject]?.selves;
  return selves && selves.length > 0 ? selves : undefined;
}

/** Subject ids a pack realises, for reporting and tests. */
export function subjectIdsOf(table: SubjectTable | undefined): string[] {
  return Object.keys(table ?? {});
}