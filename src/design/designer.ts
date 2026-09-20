/**
 * Concept designer: turns a market brief (plus learned weights) into concrete,
 * ready-to-generate song concepts.
 *
 * Every decision is drawn from the brief with a seeded RNG, so a design run is
 * reproducible from its seed, and the rationale recorded with each concept
 * explains which market evidence drove it.
 */
import { config } from '../config.js';
import { clamp, mulberry32, pickWeighted, seedFromString } from '../lib/util.js';
import { GENRE_STYLE } from './genreStyle.js';
import { flavorFor } from './marketFlavor.js';
import { buildRationale, chooseTitle, composeStylePrompt } from './prompt.js';
import { lyricProvenance } from './provenance.js';
import { GENRE_TEMPO_HINTS, clampBpm, suggestKeys, tempoClass } from '../analysis/tempo.js';
import { validateLyricPlan, writeLyrics } from './lyrics.js';
import { insertConcept, usedAgents, usedSubjects, usedTitles } from './store.js';
import type { Concept, DesignRequest, MarketWeight } from './types.js';

/** Genres that are usually instrumental in their market. */
const INSTRUMENTAL_LEANING = new Set([
  'ambient_chill',
  'classical',
  'soundtrack',
  'instrumental_newage',
  'jazz',
  'house_techno',
]);

function weightMap(weights: MarketWeight[] | undefined): Map<string, number> {
  return new Map((weights ?? []).map((w) => [w.key, w.value]));
}

/** Blends a market's chart share with the preference learned from ratings. */
function genreCandidates(
  brief: DesignRequest['brief'],
  learned: Map<string, number>,
): Array<[string, number]> {
  const entries = Object.entries(brief.genreWeights);
  if (entries.length === 0) return [['other', 1]];
  return entries.map(([genre, share]) => {
    const learnedBoost = learned.get(`genre:${genre}`) ?? 1;
    return [genre, Math.max(share, 0.01) * clamp(learnedBoost, 0.25, 3)] as [string, number];
  });
}

/**
 * Weighted BPM candidates: the market's median/IQR, nudged by which tempo band
 * previous cycles rated well for this market.
 */
function bpmCandidates(
  brief: DesignRequest['brief'],
  learned: Map<string, number>,
): Array<[number, number]> {
  const anchors = [brief.bpm.median, brief.bpm.p25, brief.bpm.p75].filter((value) => value > 0);
  const base = anchors.length > 0 ? anchors : [110];
  const out: Array<[number, number]> = [];
  for (const anchor of base) {
    const weight = clamp(learned.get(`bpm:${tempoClass(anchor)}`) ?? 1, 0.25, 3);
    for (const value of [anchor, anchor + 4, anchor - 4]) out.push([clampBpm(value), weight]);
  }
  return out;
}

function timeSignatureFor(genre: string, rng: () => number): string {
  const tripleMeters = new Set(['folk_americana', 'country', 'blues', 'regional_europe', 'devotional']);
  const roll = rng();
  if (tripleMeters.has(genre) && roll < 0.35) return '3/4';
  if (roll > 0.92) return '6/8';
  return '4/4';
}

/** Blends the market's observed song length with the configured target. */
function durationFor(brief: DesignRequest['brief'], rng: () => number): number {
  const baseline = config.design.duration > 0 ? config.design.duration : brief.durationMedian;
  const market = brief.durationMedian > 0 ? brief.durationMedian : baseline;
  const weighted = market * 0.6 + baseline * 0.4;
  return Math.round(clamp(weighted * (0.9 + rng() * 0.2), 45, 240));
}
/** Designs `count` concepts for one market. */
export function designConcepts(request: DesignRequest): Concept[] {
  const { market, brief, count } = request;
  const learned = weightMap(request.learnedWeights);
  const flavor = flavorFor(market);
  const used = usedTitles(market);
  // Subjects this market has already been given, plus the ones chosen earlier in this
  // run: a batch of three designs should be three different subjects, not one subject
  // three times. Both lists only bias the choice - design never fails for lack of one.
  const recentSubjects = usedSubjects(market);
  const runSubjects: string[] = [];
  // Same treatment for the writing style: a batch of three designs should vary in *how* it
  // is told as well as in what it is about, and a later run should not repeat the last one.
  const recentAgents = usedAgents(market);
  const runAgents: string[] = [];
  const baseSeed = request.seed ?? Math.floor(Math.random() * 1_000_000);
  const concepts: Concept[] = [];

  for (let index = 0; index < count; index += 1) {
    // Hash the per-concept seed, including the market: mulberry32 streams from
    // nearby seeds correlate, which made sibling concepts (and same-index concepts
    // in different markets) share opening lines, hooks and imagery.
    const rng = mulberry32(seedFromString(`concept:${baseSeed}:${market}:${index}`));

    const genrePool = genreCandidates(brief, learned);
    const primaryGenre = pickWeighted(genrePool, rng) ?? 'other';
    const secondaryGenre = pickWeighted(
      genrePool.filter(([genre]) => genre !== primaryGenre),
      rng,
    )?.[0];
    const genreShare = brief.genreWeights[primaryGenre] ?? 0;

    const hint = GENRE_TEMPO_HINTS[primaryGenre] ?? GENRE_TEMPO_HINTS.other;
    const marketBpm = pickWeighted(bpmCandidates(brief, learned), rng);
    const bpm = clampBpm(marketBpm && marketBpm > 0 ? marketBpm : hint.typical, hint.min, hint.max);

    const learnedKeys: Array<[string, number]> = [];
    for (const [key, value] of learned.entries()) {
      if (key.startsWith('key:')) learnedKeys.push([key.slice(4), value]);
    }
    const keyScale =
      pickWeighted(
        suggestKeys(brief.genreWeights, learnedKeys).map((k) => [k, 1] as [string, number]),
        rng,
      ) ?? 'C major';

    const instrumental = request.instrumental ?? (INSTRUMENTAL_LEANING.has(primaryGenre) && rng() < 0.35);
    // The language the market asks for. Whether a lyric pack actually exists is
    // resolved in writeLyrics, which reports a fallback rather than mislabelling
    // English lyrics with the market's language.
    const requestedLanguage =
      rng() < 0.75 || brief.languages.length === 1
        ? brief.languages[0]
        : brief.languages[1] ?? brief.languages[0];

    const energy = GENRE_STYLE[primaryGenre]?.energy ?? 0.6;
    const lyricPlan = writeLyrics({
      themes: flavor.themes,
      terms: brief.topTerms.map((t) => t.term),
      energy,
      language: requestedLanguage,
      // The genre picks the concrete-metaphor family, so images feel native.
      genre: primaryGenre,
      rng,
      instrumental,
      usedSubjects: [...recentSubjects, ...runSubjects],
      usedAgents: [...recentAgents, ...runAgents],
    });

    // Recorded so the next run in this market rotates rather than repeating.
    runSubjects.push(lyricPlan.subject);
    runAgents.push(lyricPlan.agent);

    // The language the lyrics are *actually* written in, which is what the engine
    // must be told to sing - not the language the market asked for.
    const lyricLanguage = lyricPlan.language;

    const learnedTags: string[] = [];
    for (const [key, value] of learned.entries()) {
      if (key.startsWith('tag:') && value > 1.05) learnedTags.push(key.slice(4));
    }

    const duration = durationFor(brief, rng);
    const style = composeStylePrompt({
      genres: [primaryGenre, secondaryGenre ?? primaryGenre],
      bpm,
      durationSeconds: duration,
      flavor,
      language: lyricLanguage,
      instrumental,
      learnedTags,
      // The style carries its production intent into the prompt (e.g. a breakdown and a
      // return), so the engine is asked for the arrangement the words were written for.
      styleHints: lyricPlan.agentStyleHints,
      rng,
    });

    const title = chooseTitle({
      themes: flavor.themes,
      terms: brief.topTerms.map((t) => t.term),
      used,
      rng,
    });
    used.push(title);

    const timeSignature = timeSignatureFor(primaryGenre, rng);
    const seed = Math.floor(rng() * 2_000_000_000);
    // Validated only now: a syllable budget per line means nothing until the tempo
    // and meter are known.
    const lyricValidation = validateLyricPlan(lyricPlan, { bpm, timeSignature });
    const rationale = buildRationale({
      market,
      primaryGenre,
      genreShare,
      bpm,
      tempoSource: brief.tempoSource,
      flavorTags: flavor.flavorTags,
      momentumNew: brief.momentum.newEntries.length,
      keyScale,
      learnedNotes: [
        ...(learnedTags.length > 0 ? [`tag preferences ${learnedTags.join(', ')}`] : []),
        // Surfaced in the rationale so a language fallback is impossible to miss.
        ...(lyricPlan.languageFallback ? [`language fallback: ${lyricPlan.languageNote}`] : []),
        // And so are the subject and the writing style: what they are, where they came from,
        // and whether the pack could really write them.
        `subject "${lyricPlan.subjectLabel}" (${lyricPlan.subjectSource}${
          lyricPlan.subjectMatched ? `: ${lyricPlan.subjectMatched}` : ''
        }${lyricPlan.subjectRealised ? '' : ', general material only'})`,
        `writing style "${lyricPlan.agentName}" (${lyricPlan.agentSource}${
          lyricPlan.agentRealised ? '' : ', pack lacks its primitives'
        })`,
        `lyric singability ${lyricValidation.score}`,
      ],
      engineSummary: lyricPlan.agentSummary,
    });

    concepts.push(
      insertConcept({
        market,
        briefId: brief.id,
        status: 'designed',
        title,
        style,
        lyrics: lyricPlan.lyrics,
        instrumental,
        vocalLanguage: lyricLanguage,
        bpm,
        keyScale,
        timeSignature,
        duration,
        batchSize: config.design.batchSize,
        thinking: config.design.thinking,
        enhance: config.design.enhance,
        primaryGenre,
        seed,
        rationale,
        params: {
          customMode: true,
          style,
          lyrics: lyricPlan.lyrics,
          title,
          instrumental,
          vocalLanguage: lyricLanguage,
          duration,
          bpm,
          keyScale,
          timeSignature,
          thinking: config.design.thinking,
          batchSize: config.design.batchSize,
          inferenceSteps: config.design.inferenceSteps,
          guidanceScale: config.design.guidanceScale,
          audioFormat: config.design.audioFormat,
          seed,
          randomSeed: false,
          primaryGenre,
          secondaryGenre,
          ...lyricProvenance(lyricPlan, lyricValidation),
        },
      }),
    );
  }

  return concepts;
}

/** Designs concepts across several markets. */
export function designForMarkets(
  briefs: DesignRequest['brief'][],
  count: number,
  weightsByMarket: Record<string, MarketWeight[]> = {},
  seed?: number,
): Concept[] {
  return briefs.flatMap((brief) =>
    designConcepts({
      market: brief.market,
      brief,
      count,
      learnedWeights: weightsByMarket[brief.market],
      seed: seed !== undefined ? seed + brief.market.length : undefined,
    }),
  );
}
