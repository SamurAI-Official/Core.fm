/**
 * Arc-driven lyric writer (orchestration).
 *
 * Writes to the arc in arc.ts:
 *   perspective -> uncertainty -> agency -> contradiction ->
 *   concrete metaphor -> scale expansion -> unresolved or reframed conclusion
 *
 * Subject handling: *what* the song is about is chosen here, per concept, from the
 * market's own chart words and flavour themes (see subjects.ts) and reported on the
 * plan. The writing pack owns the language it is realised in, and only subjects a
 * pack declares in `subjectCoverage` are ever chosen for it - so a subject the pack
 * cannot write is impossible to label a concept with, rather than invisible when it
 * happens.
 *
 * Language handling: the requested language resolves to a LanguagePack
 * (lyrics/index.ts) that owns both its banks and its grammar. When no pack exists
 * the fallback is *reported*, not hidden: `language` is the language the lyrics are
 * actually written in, while `requestedLanguage` and `languageFallback` record what
 * the market asked for. That distinction is what stops English words being sent to
 * the engine tagged `vocal_language=ja`.
 *
 * Chorus repeats are identical by design (the hook should be the hook), except the
 * closing chorus, which is deliberately reframed so the song ends unresolved.
 */
import { mulberry32, seedFromString } from '../lib/util.js';
import { scriptShare } from '../lib/text.js';
import { metaphorFamily } from './imagery.js';
import {
  describeArc,
  planFor,
  stageLabel,
  LYRIC_ARC,
  type LyricArcReport,
  type LyricStage,
} from './arc.js';
import { renderSection } from './lyricStages.js';
import { resolvePack } from './lyrics/index.js';
import { chooseSubject, subjectProfile } from './lyrics/subjects.js';
import type { LanguagePack, LyricContext, ScriptFamily } from './lyrics/types.js';
import { validateLyrics, type LyricValidation } from './lyrics/validate.js';

export interface LyricPlan {
  lyrics: string;
  hook: string;
  structure: string[];
  /** The language the lyrics are actually written in (the pack that wrote them). */
  language: string;
  /** The language the market asked for. */
  requestedLanguage: string;
  /** True when no pack existed for the requested language. */
  languageFallback: boolean;
  /** Why the fallback happened, for the rationale and the UI. */
  languageNote?: string;
  /** Script family of `language`, used by the validator. */
  script: ScriptFamily;
  /** Human-readable pack label. */
  packLabel: string;
  /** Topical word taken from the market's chart, when a usable one existed. */
  topicWord?: string;
  /** What the song is about (subjects.ts id) and its English label. */
  subject: string;
  subjectLabel: string;
  /** Where the subject came from: market chart words/themes, rotation, or a seeded draw. */
  subjectSource: 'chart-topic' | 'rotation' | 'seeded';
  /** The chart word or theme phrase that chose the subject, when there was one. */
  subjectMatched?: string;
  /** False when the writing pack has no material for this subject (general banks only). */
  subjectRealised: boolean;
  /** What the arc actually did - surfaced in the UI, rationale and manifest. */
  arc: LyricArcReport;
  arcSummary: string;
}


const ALL_STAGES: LyricStage[] = LYRIC_ARC.map((entry) => entry.id);

/**
 * Seeded RNG for standalone use.
 *
 * The seed is hashed first: mulberry32's first outputs are correlated for nearby
 * seeds, which made different concepts in one design batch pick the same opening
 * lines. Hashing decorrelates them while keeping runs reproducible.
 */
function seededRng(seed: number): () => number {
  return mulberry32(seedFromString(`lyric-arc:${seed}`));
}

function pickFrom<T>(rng: () => number, items: T[], fallback: T): T {
  return items[Math.floor(rng() * items.length)] ?? fallback;
}

/**
 * True when a chart word is plausibly singable in the pack's script.
 *
 * This replaces an `pack.code === 'en'` test. The old gate was correct about the risk
 * and wrong about the scope: an English token in a Korean line is the same class of
 * defect as English words tagged Japanese, but a Korean token was just as unusable
 * because no Korean pack existed. Script is the real question, not language.
 */
function isInPackScript(term: string, pack: LanguagePack): boolean {
  const trimmed = term.trim();
  if (!trimmed) return false;
  if (pack.script === 'latin') return trimmed.length >= 4 && /^[a-z]+$/.test(trimmed.toLowerCase());
  // In scripts where a single glyph is often a whole word, one character carries too
  // little meaning to stand as an ad-lib; two is the shortest useful token.
  const minimum = pack.script === 'han' || pack.script === 'hangul' || pack.script === 'japanese' ? 2 : 3;
  return scriptShare(trimmed, pack.script) >= 0.6 && Array.from(trimmed).length >= minimum;
}

/**
 * Chart word usable as the intro ad-lib.
 *
 * A word that also points at the song's subject wins, so the ad-lib reinforces what
 * the song is about instead of contradicting it; otherwise the first in-script word
 * from the chart is used.
 */
function pickTopicWord(pack: LanguagePack, terms: string[], subject: string): string | undefined {
  const inScript = terms.filter((term) => isInPackScript(term, pack));
  if (inScript.length === 0) return undefined;
  const keywords = subjectProfile(subject)?.keywords ?? [];
  const reinforcing = inScript.find((term) => {
    const lower = term.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword) || keyword.includes(lower));
  });
  return reinforcing ?? inScript[0];
}

export function writeLyrics(options: {
  /**
   * Market flavour themes. They no longer sit unused: they are one of the two
   * sources the subject is matched from.
   */
  themes: string[];
  terms: string[];
  energy: number;
  /** Requested vocal language; may fall back to English if no pack exists. */
  language: string;
  /** Drives the concrete-metaphor family (country vs. club vs. Afrobeats...). */
  genre?: string;
  rng?: () => number;
  seed?: number;
  instrumental?: boolean;
  /**
   * Subjects already used for this market (and earlier in this design run), so
   * consecutive designs rotate instead of repeating one subject.
   */
  usedSubjects?: string[];
}): LyricPlan {
  const rng = options.rng ?? seededRng(options.seed ?? 1);
  const resolution = resolvePack(options.language);
  const pack = resolution.pack;

  // What the song is about, before anything is written. The pool is limited to the
  // subjects this pack declares it can write, so the label is never a claim the pack
  // cannot honour.
  const subject = chooseSubject({
    terms: options.terms,
    themes: options.themes,
    rng,
    only: pack.subjectCoverage,
    exclude: options.usedSubjects,
  });
  const subjectRealised = (pack.subjectCoverage ?? []).includes(subject.id);

  const topicWord = pickTopicWord(pack, options.terms, subject.id);

  const plan = planFor(options.energy);

  const hook = pack.buildHook(rng);
  const scale = pack.buildScale(rng);
  const contradiction = pack.pickContradiction(rng);
  const contrast = pack.pickContrast(rng);

  // Imagery serves the subject when the subject names a register, and the market's
  // genre the rest of the time - a screen door still reads country, but a song about
  // family can reach for the roots bank even when the chart is electronic.
  const families = subjectProfile(subject.id)?.families ?? [];
  const family =
    families.length > 0 && rng() < 0.6
      ? families[Math.floor(rng() * families.length)]
      : metaphorFamily(options.genre ?? 'other');
  const metaphorBank = pack.metaphors(family);
  const metaphor = pickFrom(rng, metaphorBank, metaphorBank[0] ?? 'a door left open');
  const conclusion: 'unresolved' | 'reframed' = rng() < 0.5 ? 'reframed' : 'unresolved';

  const ctx: LyricContext = {
    rng,
    hook,
    contradiction,
    contrast,
    metaphor,
    wideSubject: scale.subject,
    wideVerb: scale.verb,
    conclusion,
    qualifier: pack.pickQualifier(rng),
    topicWord,
    subject: subject.id,
    subjectLabel: subject.label,
  };

  // Chorus repeats must match; the closing chorus is cached separately.
  const cache = new Map<string, string[]>();
  const sections = plan.map((entry) => {
    const key = entry.reframe ? `${entry.section}#reframe` : entry.section;
    let lines = cache.get(key);
    if (!lines) {
      lines = renderSection(entry, ctx, pack);
      cache.set(key, lines);
    }
    return { section: entry.section, lines };
  });

  const usedStages = new Set<LyricStage>(plan.flatMap((entry) => entry.stages));
  const arc: LyricArcReport = {
    stages: ALL_STAGES.filter((stage) => usedStages.has(stage)),
    sectionMap: plan.map((entry) => ({
      section: entry.reframe ? `${entry.section} (reframed)` : entry.section,
      stages: entry.stages,
    })),
    metaphor,
    contradiction,
    conclusion,
    scaleSubject: ctx.wideSubject,
  };

  const base = {
    hook,
    structure: plan.map((entry) => entry.section),
    language: pack.code,
    requestedLanguage: resolution.requested,
    languageFallback: resolution.fallback,
    languageNote: resolution.reason,
    script: pack.script,
    packLabel: pack.label,
    topicWord,
    subject: subject.id,
    subjectLabel: subject.label,
    subjectSource: subject.source,
    subjectMatched: subject.matched,
    subjectRealised,
    arc,
    arcSummary: describeArc(arc),
  };

  if (options.instrumental) return { ...base, lyrics: '' };

  return {
    ...base,
    lyrics: sections.map((entry) => `[${entry.section}]\n${entry.lines.join('\n')}`).join('\n\n'),
  };
}

/**
 * Runs the singability validator against a finished plan.
 *
 * Separated from `writeLyrics` because the writer does not know the tempo or meter
 * - those are chosen by the designer - and a line budget only means something once
 * the BPM is known.
 */
export function validateLyricPlan(
  plan: LyricPlan,
  options: { bpm: number; timeSignature: string },
): LyricValidation {
  return validateLyrics(plan.lyrics ?? '', {
    language: plan.language,
    script: plan.script,
    bpm: options.bpm,
    timeSignature: options.timeSignature,
  });
}

/** Stage labels in arc order (used by the UI and docs). */
export function arcStageLabels(): Array<{ id: LyricStage; label: string }> {
  return ALL_STAGES.map((id) => ({ id, label: stageLabel(id) }));
}

export type { LyricArcReport, LyricStage, LyricValidation };