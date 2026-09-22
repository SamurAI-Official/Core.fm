/**
 * The next take: what to change when a listener rejects a response to their own prompt.
 *
 * This is the visible half of the per-user layer. The profile (loops/userProfile.ts) records the
 * preference; this decides what a *retry* should do differently, and it obeys one rule above all
 * others:
 *
 *   **Only change what the machine chose, never what the person wrote.**
 *
 * A retry on a design the aggregator authored may swap the writing style, the subject, the genre and
 * the production tags, because those were drawn for the listener by the loop. A retry on a prompt the
 * listener typed themselves may not: their words are the instruction, and silently rewriting them
 * would answer a different request. For those, the honest changes are the ones they did not specify -
 * the seed, and the tempo band if they left it to us - and the rest is reported as left alone.
 *
 * Every change is explained in `note`, because "why is this different from what I asked for?" has to be
 * answerable from the response rather than by comparing two songs by ear.
 */
import { GENRE_STYLE, genreStyle } from './genreStyle.js';
import { listAgents } from './agents/registry.js';
import { tagVocabulary } from './prompt.js';
import { clampBpm, tempoClass } from '../analysis/tempo.js';
import { mulberry32 } from '../lib/util.js';
import { familyWeight, getUserWeight } from '../loops/userProfile.js';

/** The request a retry is based on - the stored params of the generation being retried. */
export interface PreviousTake {
  seed?: number;
  randomSeed?: boolean;
  bpm?: number;
  keyScale?: string;
  style?: string;
  vocalLanguage?: string;
  duration?: number;
  /** Set when the aggregator designed this request, i.e. when its choices are ours to change. */
  conceptId?: string;
  primaryGenre?: string;
  lyricAgent?: string;
  lyricSubject?: string;
  lyricThemes?: string[];
  market?: string;
}

export interface NextTakeRequest {
  rater: string;
  reasons: string[];
  previous: PreviousTake;
  /** Seeds already used for this prompt, including the rejected one: never serve any of them again. */
  excludeSeeds: number[];
  /** How many times this prompt has already been retried, so drift compounds rather than repeats. */
  attempt?: number;
}

export interface NextTake {
  seed: number;
  patch: {
    bpm?: number;
    keyScale?: string;
    style?: string;
    lyricAgent?: string;
    lyricSubject?: string;
  };
  /** Human-readable reasons for each change, in the order they were decided. */
  note: string[];
  /** Seeds deliberately avoided. */
  excluded: number[];
  /** The reasons that could not be acted on, and why - reported rather than silently dropped. */
  unactionable: string[];
  /** True when this request was designed by the loop, so its choices are ours to adjust. */
  machineDesigned: boolean;
}

/** Which parts of a take a reason wants changed. Absent reasons blame everything. */
const TEMPO_REASONS = new Set(['tempo', 'bpm']);
const KEY_REASONS = new Set(['key']);
const PRODUCTION_REASONS = new Set(['mix', 'production', 'muddy', 'artifacts', 'vocals']);
const LYRIC_REASONS = new Set(['lyrics', 'bad-lyrics', 'repetition']);
const LANGUAGE_REASONS = new Set(['language', 'pronunciation']);
const GENRE_REASONS = new Set(['genre', 'wrong-genre', 'off-prompt']);

/** A seed that has not been heard for this prompt. */
function freshSeed(excluded: Set<number>, attempt: number): number {
  let seed = Math.floor(Math.random() * 4294967295);
  let guard = 0;
  while (excluded.has(seed) && guard < 50) {
    seed = Math.floor(Math.random() * 4294967295);
    guard += 1;
  }
  // Nothing left to draw from: derive one, so a retry still cannot repeat a rejected take.
  if (excluded.has(seed)) seed = (excluded.size * 2654435761 + attempt) % 4294967295;
  return seed;
}

export function nextTake(request: NextTakeRequest): NextTake {
  const reasons = request.reasons.map((reason) => reason.toLowerCase()).filter(Boolean);
  // No reason at all means the listener made no claim about *what* was wrong, so everything the
  // machine chose is fair game - the same reading the learner takes for an unattributed complaint.
  const all = reasons.length === 0 || reasons.includes('not-my-kind');
  const blames = (family: Set<string>): boolean => all || reasons.some((reason) => family.has(reason));

  const previous = request.previous;
  const machineDesigned = Boolean(previous.conceptId || previous.lyricAgent || previous.lyricSubject);
  const attempt = Math.max(0, request.attempt ?? 0);
  const excludedSet = new Set(request.excludeSeeds.filter((seed) => Number.isFinite(seed)));
  const note: string[] = [];
  const patch: NextTake['patch'] = {};
  const unactionable: string[] = [];

  const seed = freshSeed(excludedSet, attempt);
  note.push(
    excludedSet.size > 0
      ? `a new seed (avoiding ${excludedSet.size} already-heard take${excludedSet.size === 1 ? '' : 's'})`
      : 'a new seed',
  );

  // Decisions come from the seed, so a retry is reproducible from its own params. The seed itself is
  // drawn fresh (it is the one thing that must differ), and never from the takes already heard.
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const pick = <T>(items: T[]): T => items[Math.floor(rng() * items.length) % items.length];

  if (blames(TEMPO_REASONS) && previous.bpm && previous.bpm > 0) {
    // Move a whole tempo band, not a few BPM: a retry that sounds the same is not a retry.
    const direction = rng() < 0.5 ? -1 : 1;
    const current = tempoClass(previous.bpm);
    let target = clampBpm(previous.bpm + direction * 18);
    if (tempoClass(target) === current) target = clampBpm(previous.bpm + direction * 32);
    patch.bpm = target;
    note.push(`tempo moved from ${previous.bpm} BPM (${current}) to ${target} BPM (${tempoClass(target)})`);
  }

  if (blames(KEY_REASONS) && previous.keyScale) {
    const root = previous.keyScale.split(' ')[0];
    const roots = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].filter((r) => r !== root);
    const mode = previous.keyScale.includes('minor') ? 'minor' : 'major';
    patch.keyScale = `${pick(roots)} ${mode}`;
    note.push(`key moved from ${previous.keyScale} to ${patch.keyScale}`);
  }


  // Production tags: the ones this listener's own profile has damped go first, then the ones it has
  // formed no opinion on. Removing is the change; inventing new tags would be guessing.
  if (blames(PRODUCTION_REASONS) && previous.style) {
    const vocabulary = tagVocabulary(previous.primaryGenre ? [previous.primaryGenre] : []);
    const present = vocabulary.filter((tag) => previous.style!.toLowerCase().includes(tag.toLowerCase()));
    const drop = present
      .map((tag) => ({ tag, weight: getUserWeight(request.rater, `tag:${tag}`, 1) }))
      .sort((a, b) => a.weight - b.weight)
      .slice(0, 2);
    if (drop.length > 0) {
      const kept = previous.style
        .split(',')
        .map((part) => part.trim())
        .filter((part) => !drop.some((entry) => part.toLowerCase() === entry.tag.toLowerCase()));
      patch.style = kept.join(', ');
      note.push(
        `dropped production tag${drop.length === 1 ? '' : 's'} ${drop.map((entry) => entry.tag).join(', ')}` +
          (drop.some((entry) => entry.weight < 1) ? ' (things you have objected to before)' : ''),
      );
    } else {
      note.push('no production tags to drop from this prompt');
    }
  }

  if (machineDesigned && blames(LYRIC_REASONS)) {
    // A different writing style, preferring one this listener has not damped.
    const chosen = listAgents()
      .map((agent) => agent.id)
      .filter((id) => id !== previous.lyricAgent)
      .map((id) => ({ id, weight: getUserWeight(request.rater, `agent:${id}`, 1) }))
      .sort((a, b) => b.weight - a.weight)[0];
    if (chosen) {
      patch.lyricAgent = chosen.id;
      note.push(
        `a different writing style: ${chosen.id}` +
          (chosen.weight > 1
            ? ' (one you have liked before)'
            : chosen.weight < 1
              ? ' (though you have objected to it before)'
              : ''),
      );
    }
    if (previous.lyricSubject) {
      // Clearing the subject lets the designer draw a new one for the market rather than reusing the
      // subject that was rejected along with the words.
      patch.lyricSubject = undefined;
      note.push('a new subject drawn for the market rather than the one you rejected');
    }
  } else if (!machineDesigned && blames(LYRIC_REASONS)) {
    note.push('the words are yours on this prompt, so they were left exactly as you wrote them');
  }

  for (const reason of reasons) {
    if (LANGUAGE_REASONS.has(reason)) {
      unactionable.push(
        `${reason}: the sung language belongs to the market or to your own prompt, so it is not changed on your behalf`,
      );
    } else if (!machineDesigned && GENRE_REASONS.has(reason)) {
      unactionable.push(`${reason}: the genre is yours to change on this prompt`);
    }
  }

  if (blames(GENRE_REASONS) && machineDesigned && previous.primaryGenre) {
    // A different genre for the same market, weighed by what this listener has preferred, and the
    // style prompt comes with it (GENRE_STYLE is the loop's own mapping, so this is not improvisation).
    const chosen = Object.keys(GENRE_STYLE)
      .filter((genre) => genre !== previous.primaryGenre)
      .map((genre) => ({ genre, weight: getUserWeight(request.rater, `genre:${genre}`, 1) }))
      .filter((entry) => entry.weight !== 1)
      .sort((a, b) => b.weight - a.weight)[0];
    if (chosen) {
      // The genre's own style data, composed the same way the designer composes it (tags first, then
      // the instruments and mood that genre implies) - not invented terms.
      const style = genreStyle(chosen.genre);
      patch.style = [...style.tags.slice(0, 3), ...style.instruments.slice(0, 2), ...style.mood.slice(0, 1)].join(
        ', ',
      );
      note.push(`a genre you prefer instead: ${chosen.genre}, with its own style prompt`);
    }
  }

  // What the profile says about a knob nobody named, so a repeat hard no drifts instead of repeating.
  if ((attempt > 0 || all) && machineDesigned && !patch.lyricAgent && familyWeight(request.rater, 'agent') < 1) {
    const chosen = listAgents()
      .map((agent) => agent.id)
      .filter((id) => id !== previous.lyricAgent)
      .map((id) => ({ id, weight: getUserWeight(request.rater, `agent:${id}`, 1) }))
      .sort((a, b) => b.weight - a.weight)[0];
    if (chosen) {
      patch.lyricAgent = chosen.id;
      note.push(`your profile is cool on writing styles generally, so ${chosen.id} was drawn instead`);
    }
  }

  return { seed, patch, note, excluded: [...excludedSet], unactionable, machineDesigned };
}

