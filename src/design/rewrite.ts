/**
 * Re-writes stored lyrics from each market's own sample data.
 *
 * Five writing styles used to place their key line in every section of a song - a claim sung 9x
 * out of 16, a refrain 11x - and every design written before that was fixed still carries those
 * lyrics. They are stored records, so this re-runs the *lyric* half of the design for them: the
 * same inputs the reroll endpoint uses (the market's latest brief terms and its flavour themes)
 * plus the concept's own genre, requested language, tempo and meter. Everything that is not a
 * lyric is left alone - title, style prompt, key, duration, batch size, seed.
 *
 * Three deliberate properties:
 *
 *   - a concept keeps the writing style it was designed with unless `redrawStyles` is set, so a
 *     rewrite fixes how the song is built without silently changing which style built it (and the
 *     original *source* of that style - rotation, affinity - is preserved rather than rewritten
 *     as "seeded", because a kept style was not drawn again);
 *   - the draw is seeded from the concept id plus the run seed, so one run is reproducible and the
 *     next run differs: "based on the sample data each time" means a fresh draw against the
 *     current chart sample, not a frozen answer;
 *   - the rationale is rebuilt as well, because it names the subject, the style and the
 *     singability score - all three of which a rewrite changes, and a rationale naming the old
 *     subject is a lie the UI would repeat.
 *
 * Rotation is per market and accumulates through the run, exactly as the designer does it, so a
 * batch does not hand every design in a market the same subject.
 */
import { latestBrief } from '../briefs/build.js';
import { seedFromString } from '../lib/util.js';
import { getWeights } from '../loops/ratings.js';
import { GENRE_STYLE } from './genreStyle.js';
import { flavorFor, lyricThemesFor } from './marketFlavor.js';
import { validateLyricPlan, writeLyrics, type LyricPlan } from './lyrics.js';
import { resolvePack } from './lyrics/index.js';
import { validateLyrics, type LyricValidation } from './lyrics/validate.js';
import { buildRationale } from './prompt.js';
import { lyricProvenance } from './provenance.js';
import { listConcepts, updateConceptLyrics, usedAgents, usedSubjects } from './store.js';
import type { Concept } from './types.js';

export interface RewriteOptions {
  market?: string;
  limit?: number;
  /** Distinguishes one rewrite run from the next. The same seed reproduces the same lyrics. */
  seed?: number;
  /** Draw a fresh writing style instead of keeping the one the concept was designed with. */
  redrawStyles?: boolean;
  /** Report what would change without writing anything. */
  dryRun?: boolean;
  onEvent?: (message: string) => void;
}

export interface RewriteOutcome {
  id: string;
  market: string;
  title: string;
  agent: string;
  agentName: string;
  subjectLabel: string;
  score: number;
  /** Most-sung line, before and after, as a share of the lyric. */
  beforeLineShare: number;
  afterLineShare: number;
  beforeMostSung: number;
  afterMostSung: number;
}

export interface RewriteReport {
  considered: number;
  rewritten: number;
  skipped: { instrumental: number; noLyrics: number };
  /** Designs that were over the repetition ceiling and are not any more. */
  fixed: number;
  /** Designs still over the ceiling afterwards - not expected, and worth seeing if it happens. */
  stillOver: number;
  outcomes: RewriteOutcome[];
}

/** The ceilings `agent-spread.ts` holds the writer to, so a rewrite can be judged the same way. */
const CEILINGS = { device: 0.4, fault: 0.35 };

/**
 * Repetition of what is stored on the concept right now, measured with the validator rather than
 * with a second implementation - the same notion of sameness (headers excluded, parentheses
 * stripped) the writer and the gate use.
 */
function storedRepetition(concept: Concept): { lineShare: number; mostSung: number } {
  const params = concept.params ?? {};
  const language =
    typeof params.lyricLanguage === 'string' && params.lyricLanguage.length > 0
      ? params.lyricLanguage
      : concept.vocalLanguage;
  const validation = validateLyrics(concept.lyrics, {
    language,
    script: resolvePack(language).pack.script,
    bpm: concept.bpm,
    timeSignature: concept.timeSignature,
    repetitionPolicy: params.lyricRepetitionPolicy === 'device' ? 'device' : 'fault',
  });
  return { lineShare: validation.maxLineShare, mostSung: validation.maxLineRepeats };
}

/**
 * The "why" prose, rebuilt from the current evidence.
 *
 * It follows the designer's format deliberately: the Trends panel reads a rationale, not a
 * schema, so a rewritten concept whose rationale still named the previous subject would read as
 * another song's notes.
 */
function rebuiltRationale(
  concept: Concept,
  plan: LyricPlan,
  validation: LyricValidation,
  learnedTags: string[],
): string {
  const brief = latestBrief(concept.market);
  const flavor = flavorFor(concept.market);
  return buildRationale({
    market: concept.market,
    primaryGenre: concept.primaryGenre,
    genreShare: brief?.genreWeights?.[concept.primaryGenre] ?? 0,
    bpm: concept.bpm,
    tempoSource: brief?.tempoSource ?? 'hinted',
    flavorTags: flavor.flavorTags,
    momentumNew: brief?.momentum?.newEntries?.length ?? 0,
    keyScale: concept.keyScale,
    learnedNotes: [
      ...(learnedTags.length > 0 ? [`tag preferences ${learnedTags.join(', ')}`] : []),
      ...(plan.languageFallback ? [`language fallback: ${plan.languageNote}`] : []),
      `subject "${plan.subjectLabel}" (${plan.subjectSource}${
        plan.subjectMatched ? `: ${plan.subjectMatched}` : ''
      }${plan.subjectRealised ? '' : ', general material only'})`,
      `writing style "${plan.agentName}" (${plan.agentSource}${
        plan.agentRealised ? '' : ', pack lacks its primitives'
      })`,
      `lyric singability ${validation.score}`,
    ],
    engineSummary: plan.agentSummary,
  });
}

/** Tags this market's ratings have pushed above neutral, as the designer reads them. */
function learnedTagsFor(market: string): string[] {
  return getWeights(market)
    .filter((weight) => weight.value > 1.05 && weight.key.startsWith('tag:'))
    .map((weight) => weight.key.slice(4));
}

export function rewriteLyrics(options: RewriteOptions = {}): RewriteReport {
  const { market, dryRun = false, redrawStyles = false, onEvent } = options;
  const runSeed = options.seed ?? 1;
  const concepts = listConcepts({ market, limit: options.limit ?? 1000 });

  const report: RewriteReport = {
    considered: 0,
    rewritten: 0,
    skipped: { instrumental: 0, noLyrics: 0 },
    fixed: 0,
    stillOver: 0,
    outcomes: [],
  };
  const runAgents = new Map<string, string[]>();
  const runSubjects = new Map<string, string[]>();
  const runList = (store: Map<string, string[]>, key: string): string[] => {
    const existing = store.get(key);
    if (existing) return existing;
    const created: string[] = [];
    store.set(key, created);
    return created;
  };

  for (const concept of concepts) {
    report.considered += 1;
    if (concept.instrumental) {
      report.skipped.instrumental += 1;
      continue;
    }
    if (!(concept.lyrics ?? '').trim()) {
      report.skipped.noLyrics += 1;
      continue;
    }

    const params = concept.params ?? {};
    const brief = latestBrief(concept.market);
    const flavor = flavorFor(concept.market);
    // The market's own sample decides what the song is about; the static regional themes are only
    // the fallback, and which one was used is recorded on the concept.
    const themeChoice = lyricThemesFor(concept.market, brief);
    const requestedLanguage =
      typeof params.requestedLanguage === 'string' && params.requestedLanguage.length > 0
        ? params.requestedLanguage
        : concept.vocalLanguage;
    const existingAgent = typeof params.lyricAgent === 'string' ? params.lyricAgent : undefined;
    const before = storedRepetition(concept);

    const plan = writeLyrics({
      themes: themeChoice.themes,
      terms: (brief?.topTerms ?? []).map((term) => term.term),
      energy: GENRE_STYLE[concept.primaryGenre]?.energy ?? 0.6,
      language: requestedLanguage,
      genre: concept.primaryGenre,
      seed: seedFromString(`${concept.id}:${runSeed}`),
      ...(redrawStyles || !existingAgent ? {} : { agent: existingAgent }),
      instrumental: false,
      usedAgents: [...usedAgents(concept.market), ...runList(runAgents, concept.market)],
      usedSubjects: [...usedSubjects(concept.market), ...runList(runSubjects, concept.market)],
    });
    runList(runAgents, concept.market).push(plan.agent);
    runList(runSubjects, concept.market).push(plan.subject);

    const validation = validateLyricPlan(plan, { bpm: concept.bpm, timeSignature: concept.timeSignature });
    const provenance = lyricProvenance(plan, validation);
    // Where the subject's material came from, so "why is this song about a long way home" is
    // answerable from the concept.
    provenance.lyricThemeSource = themeChoice.source;
    provenance.lyricThemes = themeChoice.themes;
    if (!redrawStyles && existingAgent === plan.agent && typeof params.lyricAgentSource === 'string') {
      // A kept style was chosen at design time, so its source survives the rewrite; `rerolledAt`
      // is what marks the lyrics as rewritten.
      provenance.lyricAgentSource = params.lyricAgentSource;
    }

    const ceiling = CEILINGS[plan.repetitionPolicy];
    const afterShare = validation.maxLineShare;
    const wasOver = before.lineShare > CEILINGS[params.lyricRepetitionPolicy === 'device' ? 'device' : 'fault'];
    if (wasOver && afterShare <= ceiling) report.fixed += 1;
    if (afterShare > ceiling) report.stillOver += 1;

    if (!dryRun) {
      updateConceptLyrics(
        concept.id,
        plan.lyrics,
        plan.language,
        provenance,
        rebuiltRationale(concept, plan, validation, learnedTagsFor(concept.market)),
      );
    }
    report.rewritten += 1;

    report.outcomes.push({
      id: concept.id,
      market: concept.market,
      title: concept.title,
      agent: plan.agent,
      agentName: plan.agentName,
      subjectLabel: plan.subjectLabel,
      score: validation.score,
      beforeLineShare: before.lineShare,
      afterLineShare: afterShare,
      beforeMostSung: before.mostSung,
      afterMostSung: validation.maxLineRepeats,
    });
  }

  onEvent?.(
    `${dryRun ? 'would rewrite' : 'rewrote'} ${report.rewritten} of ${report.considered} design(s): ` +
      `${report.fixed} moved off the repetition ceiling, ${report.stillOver} still on it, ` +
      `${report.skipped.instrumental} instrumental and ${report.skipped.noLyrics} lyric-less skipped`,
  );
  return report;
}
