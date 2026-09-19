/**
 * Arc-driven lyric writer (orchestration).
 *
 * Writes to the arc in arc.ts:
 *   perspective -> uncertainty -> agency -> contradiction ->
 *   concrete metaphor -> scale expansion -> unresolved or reframed conclusion
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
import type { LyricContext, ScriptFamily } from './lyrics/types.js';
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

export function writeLyrics(options: {
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
}): LyricPlan {
  const rng = options.rng ?? seededRng(options.seed ?? 1);
  const resolution = resolvePack(options.language);
  const pack = resolution.pack;

  // A chart term is only usable as an ad-lib when it is in the language's own
  // script. Injecting an English token into a French or German lyric is the same
  // class of defect as English words being tagged Japanese.
  const topicWord =
    pack.code === 'en'
      ? options.terms.find((term) => term.length >= 4 && /^[a-z]+$/.test(term))
      : undefined;

  const plan = planFor(options.energy);

  const hook = pack.buildHook(rng);
  const scale = pack.buildScale(rng);
  const contradiction = pack.pickContradiction(rng);
  const contrast = pack.pickContrast(rng);
  const metaphorBank = pack.metaphors(metaphorFamily(options.genre ?? 'other'));
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