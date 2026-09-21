/**
 * Helpers shared by the writing styles.
 *
 * Every style arranges lines the pack already owns, so the same few operations appear in
 * almost all of them: draw N lines from a stage, prefer a primitive when the pack has one,
 * and keep a little song-scoped state (the image being followed, the opening line that has
 * to come back).
 */
import { estimateSyllables } from '../lyrics/validate.js';
import { primitiveBank } from '../lyrics/primitives.js';
import type { PrimitiveId } from '../lyrics/primitives.js';
import type { LanguagePack, LyricContext } from '../lyrics/types.js';
import type { LyricStage } from '../arc.js';

/** Lines from one of the pack's own stages, grammar guaranteed by the pack. */
export function stageLines(
  pack: LanguagePack,
  ctx: LyricContext,
  stage: LyricStage,
  count: number,
  used?: Set<string>,
): string[] {
  return pack.render[stage](count, ctx, used ?? new Set<string>());
}

/**
 * A primitive's lines, or none when the pack has no such bank.
 *
 * Styles use this rather than declaring the primitive in `needs` when they can read just as
 * well without it: presence upgrades the output, absence does not break the style. Anything
 * a style *cannot* do without belongs in `needs` instead, which is what keeps a style from
 * ever being chosen for a pack that cannot write it.
 */
export function optionalPrimitive(pack: LanguagePack, id: PrimitiveId): string[] {
  return primitiveBank(pack, id);
}

/** The shortest of these lines, for a break that has to read as stripped back. */
export function shortestLine(lines: string[], script: LanguagePack['script']): string | undefined {
  return [...lines].sort((a, b) => estimateSyllables(a, script) - estimateSyllables(b, script))[0];
}

/**
 * Distinct lines, in order.
 *
 * "Distinct" is judged the way the validator judges repetition - lower-cased, parentheses removed,
 * trimmed - because a line and its parenthesised backing-vocal echo are the same line to the gate.
 * A style that emits `(X)` next to `X` in one section is a fault even though the strings differ.
 */
export function uniq(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase().replace(/[()]/g, '').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/** First line of a list, or undefined (a bank can be empty). */
export function firstLine(lines: string[]): string | undefined {
  return lines[0];
}

/**
 * Stage lines with one line removed.
 *
 * The styles that repeat a key line on purpose need the *rest* of their sections to be other
 * lines: a hook that also opens every verse is not a hook, it is the song. Measured across the
 * first 120 designs, `hook-variation-payoff` sang its claim 9 times in 16 lines and
 * `refrain-mutation` sang its refrain 11 times, because the key line was placed in every section
 * *and* several times inside the chorus that followed. Both now keep the key line where it does
 * its work (the chorus, the bridge, the outro) and hand the verses back to the context banks.
 */
export function withoutLine(lines: string[], line: string): string[] {
  return lines.filter((entry) => entry !== line);
}

/**
 * Song-scoped state, keyed by the lyric context.
 *
 * `ctx` is created once per `writeLyrics` call, so a WeakMap keyed by it gives a style a
 * place to remember what it has already done - the object being followed, the opening line
 * that must return at the end - without the orchestrator knowing that style needs anything.
 */
const perSong = new WeakMap<LyricContext, Map<string, unknown>>();

export function songState<T>(ctx: LyricContext, key: string, create: () => T): T {
  let state = perSong.get(ctx);
  if (!state) {
    state = new Map<string, unknown>();
    perSong.set(ctx, state);
  }
  if (!state.has(key)) state.set(key, create());
  return state.get(key) as T;
}

/** A stable "one line per song" draw: the same line every time this style asks for it. */
export function onceLine(
  ctx: LyricContext,
  key: string,
  draw: () => string | undefined,
  fallback: string,
): string {
  return songState<string>(ctx, key, () => draw() ?? fallback);
}

/**
 * One primitive line, drawn once per song.
 *
 * Styles need this constantly - the promise that gets broken, the belief that gets revised, the
 * obstacle at each rung of the ladder - and drawing it twice would let the report name a line the
 * lyric never sings.
 */
export function oncePrimitive(
  ctx: LyricContext,
  pack: LanguagePack,
  id: PrimitiveId,
  key: string,
  index = 0,
): string | undefined {
  return songState<string | undefined>(ctx, key, () => optionalPrimitive(pack, id)[index]);
}
