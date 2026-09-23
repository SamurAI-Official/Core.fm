/**
 * The corpus an edition is trained on: the preference ledger turned into a mix, with the guards that
 * keep the loop from eating itself.
 *
 * Training on your own liked output collapses - the model drifts toward its own habits and the chart
 * signal that gave it something to say in the first place is diluted away. So the mix is three parts,
 * and only one of them is feedback:
 *
 *   1. **preference pairs** from the ledger: a prompt, what it produced, and what the listener said
 *      about it. Verdicts are the *signal*, not the whole diet.
 *   2. **anchors**: designs nobody has judged, taken from the loop's own chart-derived and curated
 *      material. These are what stop the mix being a closed loop over its own output, and their absence
 *      is a refusal to train rather than a smaller dataset.
 *   3. **positives outnumbering negatives** by a bounded ratio. Dislikes teach a model what to avoid, and
 *      a model taught only avoidance learns to avoid everything - so the cap is not a nicety, it is the
 *      difference between a tuned model and a mute one.
 *
 * The split is by **prompt**, not by response: a random response split would leave the held-out half
 * full of prompts the candidate was trained on, which measures memorisation rather than preference. The
 * assignment is a hash of the prompt key, so it is stable as new feedback arrives - a held-out pair that
 * moved between builds would leak into the next training run.
 *
 * Everything here is deterministic given the ledger, so the same ledger builds the same corpus and the
 * `hash` an edition records is a real promise about what it was trained on.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { pool, jsonParse } from '../db/index.js';
import { currentEdition, tuningBase } from '../loops/editions.js';
import type { FeedbackFeatures, FeedbackVerdict } from '../scoring/feedback.js';

/** One judged response, as the corpus sees it. */
export interface CorpusSample {
  /** The response: the app's song id, or `run:<run id>` for one of the loop's own renders. */
  id: string;
  /** Where the response lives, so an executor can find the audio. Null when the render is gone. */
  audio: string | null;
  /** Which half of the system produced it: a listener's own song, or a designed render of this loop. */
  origin: 'song' | 'run';
  /** The prompt it answered, used for the split. Falls back to the response id when unknown. */
  promptKey: string;
  market: string | null;
  verdict: FeedbackVerdict;
  reasons: string[];
  /** The edition that produced it, as reported by the renderer. Null when unknown (pre-attribution). */
  edition: string | null;
  createdAt: string;
  features: FeedbackFeatures;
}

/** A design nobody has judged: the anchor that keeps the mix from being all feedback. */
export interface AnchorSample {
  id: string;
  market: string;
  title: string;
  style: string;
  primaryGenre: string;
  lyrics: string;
  instrumental: boolean;
  vocalLanguage: string;
  bpm: number;
  createdAt: string;
  /** True when the design carries the market's own chart words, i.e. it is signal-derived material. */
  chartDerived: boolean;
}

export interface CorpusManifest {
  /** Deterministic over the sample list: two builds from the same ledger agree. */
  hash: string;
  builtAt: string;
  editionOrdinal: number;
  baseId: string | null;
  counts: {
    judged: number;
    liked: number;
    disliked: number;
    train: number;
    heldOutPairs: number;
    anchors: number;
    /**
     * Where the judged material came from: a listener's own songs, or the loop's own rated renders. An
     * edition trained only on the first is being tuned on the app's output; only on the second, on the
     * loop's. The mix should be visible rather than assumed.
     */
    songs: number;
    runs: number;
    /** Judged samples whose audio the executor can actually reach - the ones it could train on. */
    withAudio: number;
    /** Samples dropped by the negatives cap - dropped, not hidden, so the mix can be audited. */
    negativesDropped: number;
    /** Verdicts held back because they are evaluation evidence rather than training material. */
    evaluationExcluded: number;
  };
  /** Which edition each sample came from: the loop's own provenance, so drift is measurable. */
  byEdition: Record<string, number>;
  reasons: Record<string, number>;
  markets: Record<string, number>;
  guards: {
    heldOutShare: number;
    maxNegativesPerPositive: number;
    minAnchors: number;
    minTrainSamples: number;
    minHeldOutPairs: number;
  };
  /** Everything that stops this corpus being trained on, if anything does. */
  blockers: string[];
}

export interface EditionCorpus {
  hash: string;
  manifest: CorpusManifest;
  /** Judged samples for training, after the negatives cap. */
  train: CorpusSample[];
  /** Held-out prompts: what the listener wanted more and less of, on a prompt the candidate never saw. */
  heldOut: Array<{ promptKey: string; market: string | null; liked: CorpusSample[]; disliked: CorpusSample[] }>;
  anchors: AnchorSample[];
  /** Everything the hash was taken over, in a stable order. */
  all: CorpusSample[];
}

function judgedSamples(): { samples: CorpusSample[]; judgedConceptIds: Set<string> } {
  // Evaluation verdicts are excluded: they come from listening to the held-out prompts, and training on
  // them would make the next gate measure memorisation of its own test set.
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT id, verdict, reasons, features, market, source_id, prompt_id, edition, created_at
     FROM feedback
     WHERE source_id IS NOT NULL AND withdrawn = 0 AND role <> 'evaluation'
     ORDER BY created_at ASC, id ASC`,
  );
  const fromFeedback: CorpusSample[] = rows.map((row) => ({
    id: String(row.source_id),
    // A verdict is on a song the listener heard through the app; the audio is the app's own.
    audio: null,
    origin: 'song' as const,
    promptKey: row.prompt_id ? String(row.prompt_id) : String(row.source_id),
    market: row.market ? String(row.market) : null,
    verdict: String(row.verdict) as FeedbackVerdict,
    reasons: jsonParse<string[]>(row.reasons, []),
    edition: row.edition ? String(row.edition) : null,
    createdAt: String(row.created_at),
    features: jsonParse<FeedbackFeatures>(row.features, {}),
  }));

  const { samples: fromRuns, judgedConceptIds } = runRatingSamples();
  return { samples: [...fromFeedback, ...fromRuns], judgedConceptIds };
}

/**
 * Judged renders of this loop's own designs, read from the run ratings.
 *
 * The ledger covers what a listener said about a *song they were given*. The loop also renders its own
 * designs, rates them, and keeps the audio - and those ratings are judgements of the same kind ("more of
 * this" / "less of this"), recorded in a different table for historical reasons. Leaving them out made a
 * batch of forty-odd renders with five ratings look like an empty corpus, which is the same blind spot that
 * hid the app's likes (17.17).
 *
 * Three rules, so that a rating means what the ledger's verdicts mean:
 *
 *   - **an explicit verdict wins.** A rating carrying `like`/`dislike` is that, regardless of score.
 *   - **otherwise the thresholds are the loop's own**: at or above the champion bar is a positive, below
 *     the viable bar is a negative, and the band between them is *ambiguous* - skipped rather than guessed
 *     at, because inventing a preference from a middling score is exactly the kind of inference this
 *     system refuses elsewhere.
 *   - **only the latest rating of a run counts.** Re-rating is a change of mind, and the run's audio did
 *     not change between the two.
 *
 * The prompt key is the concept, so the held-out split holds out *whole designs* - the renders of one
 * concept share their words, style and market, and splitting them across the two halves would leak the
 * design into training.
 */
function runRatingSamples(): { samples: CorpusSample[]; judgedConceptIds: Set<string> } {
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT r.id AS rating_id, r.run_id, r.score, r.verdict AS explicit, r.created_at,
            run.concept_id, run.market, run.local_audio,
            c.primary_genre, c.bpm, c.key_scale, c.style, c.vocal_language, c.params
     FROM ratings r
     JOIN runs run ON run.id = r.run_id
     LEFT JOIN concepts c ON c.id = run.concept_id
     WHERE r.score IS NOT NULL
     ORDER BY r.created_at ASC, r.id ASC`,
  );

  const latest = new Map<string, Record<string, unknown>>();
  for (const row of rows) latest.set(String(row.run_id), row);

  const samples: CorpusSample[] = [];
  const judgedConceptIds = new Set<string>();
  for (const row of latest.values()) {
    const score = Number(row.score);
    const explicit = row.explicit === 'like' || row.explicit === 'dislike' ? row.explicit : null;
    const verdict: FeedbackVerdict | null =
      explicit ??
      (score >= config.scoring.championThreshold
        ? 'like'
        : score < config.scoring.viableThreshold
          ? 'dislike'
          : null);
    if (!verdict) continue;
    const conceptId = row.concept_id ? String(row.concept_id) : null;
    if (conceptId) judgedConceptIds.add(conceptId);
    const params = row.params ? jsonParse<Record<string, unknown>>(row.params, {}) : {};
    const audio = jsonParse<string[]>(row.local_audio, [])[0] ?? null;
    samples.push({
      id: `run:${String(row.run_id)}`,
      audio,
      origin: 'run',
      // Whole designs are held out, not single renders.
      promptKey: conceptId ? `concept:${conceptId}` : `run:${String(row.run_id)}`,
      market: row.market ? String(row.market) : null,
      verdict,
      reasons: [],
      // The loop did not record which edition rendered these; they predate that provenance.
      edition: null,
      createdAt: String(row.created_at),
      features: {
        genre: row.primary_genre ? String(row.primary_genre) : undefined,
        bpm: row.bpm === null || row.bpm === undefined ? undefined : Number(row.bpm),
        keyScale: row.key_scale ? String(row.key_scale) : undefined,
        style: row.style ? String(row.style) : undefined,
        agent: typeof params.lyricAgent === 'string' ? params.lyricAgent : undefined,
        subject: typeof params.lyricSubject === 'string' ? params.lyricSubject : undefined,
        language: row.vocal_language ? String(row.vocal_language) : undefined,
        themes: Array.isArray(params.lyricThemes) ? (params.lyricThemes as string[]) : undefined,
      },
    });
  }
  return { samples, judgedConceptIds };
}

/**
 * Anchors: recent designs nobody has judged, preferring the ones carrying chart material.
 *
 * Judged designs are excluded deliberately - if an anchor were also a pair, that material would be
 * counted twice and the mix would quietly drift back toward being all feedback.
 */
function anchorSamples(limit: number, judgedIds: Set<string>): AnchorSample[] {
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT id, market, title, style, lyrics, instrumental, vocal_language, bpm, primary_genre,
            params, created_at
     FROM concepts
     WHERE status IN ('designed', 'generated', 'scored')
     ORDER BY created_at DESC LIMIT ?`,
    [Math.max(limit * 4, 40)],
  );
  const anchors: AnchorSample[] = [];
  for (const row of rows) {
    const id = String(row.id);
    if (judgedIds.has(id)) continue;
    const params = row.params ? jsonParse<Record<string, unknown>>(row.params, {}) : {};
    anchors.push({
      id,
      market: String(row.market),
      title: String(row.title),
      style: String(row.style),
      primaryGenre: String(row.primary_genre ?? 'other'),
      lyrics: String(row.lyrics ?? ''),
      instrumental: Number(row.instrumental ?? 0) === 1,
      vocalLanguage: String(row.vocal_language ?? 'en'),
      bpm: Number(row.bpm ?? 0),
      createdAt: String(row.created_at),
      chartDerived: Boolean(params.topicWord) || params.lyricThemeSource === 'signal',
    });
    if (anchors.length >= limit) break;
  }
  return anchors;
}

/** Stable per-prompt bucket in [0,1): the split must not move when new feedback arrives. */
function promptBucket(promptKey: string): number {
  const digest = createHash('sha256').update(promptKey).digest();
  return digest.readUInt32BE(0) / 0x100000000;
}

/** A short, stable digest of exactly what went into a corpus. */
function corpusHash(input: {
  train: CorpusSample[];
  heldOut: EditionCorpus['heldOut'];
  anchors: AnchorSample[];
  guards: CorpusManifest['guards'];
}): string {
  const canonical = JSON.stringify({
    train: input.train.map((sample) => [sample.id, sample.verdict, sample.reasons.slice().sort(), sample.edition]),
    heldOut: input.heldOut.map((pair) => [
      pair.promptKey,
      pair.liked.map((s) => s.id).sort(),
      pair.disliked.map((s) => s.id).sort(),
    ]),
    anchors: input.anchors.map((anchor) => [anchor.id, anchor.style, anchor.chartDerived]),
    guards: input.guards,
  });
  return createHash('sha256').update(canonical).digest('hex');
}


export interface CorpusOptions {
  heldOutShare?: number;
  maxNegativesPerPositive?: number;
  minAnchors?: number;
  minTrainSamples?: number;
  minHeldOutPairs?: number;
}

/**
 * Builds the corpus for the next edition: what it trains on, what it is judged by, and why it might not
 * be trained at all.
 *
 * A thin corpus is *reported*, never silently trained on. `blockers` is empty when the corpus is usable
 * and carries the reason when it is not - and the two conditions that block are exactly the two failure
 * modes: too little preference evidence to learn a preference from, and too few anchors to keep the
 * model from drifting onto its own output.
 */
export function buildCorpus(options: CorpusOptions = {}): EditionCorpus {
  const guards = {
    heldOutShare: options.heldOutShare ?? config.edition.heldOutShare,
    maxNegativesPerPositive: options.maxNegativesPerPositive ?? config.edition.maxNegativesPerPositive,
    minAnchors: options.minAnchors ?? config.edition.minAnchors,
    minTrainSamples: options.minTrainSamples ?? config.edition.minTrainSamples,
    minHeldOutPairs: options.minHeldOutPairs ?? config.edition.minHeldOutPairs,
  };

  const judged = judgedSamples();
  const all = judged.samples;
  // Both the judged response ids and the *concepts* a rated render belongs to: an anchor is a design, so a
  // design whose render has been judged must not also appear as one, or its material is counted twice.
  const judgedIds = new Set<string>([...all.map((sample) => sample.id), ...judged.judgedConceptIds]);
  const evaluationExcluded = Number(
    pool.query<Record<string, unknown>>(
      "SELECT COUNT(*) AS n FROM feedback WHERE source_id IS NOT NULL AND role = 'evaluation'",
    ).rows[0]?.n ?? 0,
  );

  // Split by prompt. A prompt is held out whole, so a held-out pair is a prompt the candidate never saw.
  const train: CorpusSample[] = [];
  const heldOutPairs: EditionCorpus['heldOut'] = [];
  const byPrompt = new Map<string, CorpusSample[]>();
  for (const sample of all) {
    const list = byPrompt.get(sample.promptKey) ?? [];
    list.push(sample);
    byPrompt.set(sample.promptKey, list);
  }
  for (const [promptKey, samples] of [...byPrompt.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (promptBucket(promptKey) < guards.heldOutShare) {
      const liked = samples.filter((s) => s.verdict === 'like');
      const disliked = samples.filter((s) => s.verdict === 'dislike');
      /**
       * A held-out prompt needs a **liked reference**, not a dislike.
       *
       * The judge - a person listening or a measurement comparing - renders the prompt under both editions
       * and asks which render is closer to what the listener liked *here*. That reference is what it needs;
       * a pre-existing dislike adds nothing it can use. Requiring both sides was a leftover from the older
       * formulation, and it made a real batch unusable: eleven likes across eleven prompts and two dislikes
       * elsewhere produce exactly zero pairs, so a corpus with plenty of material looked empty.
       *
       * Held out is still whole-prompt, so the prompt a candidate is judged on is one it never trained on.
       */
      if (liked.length > 0) {
        heldOutPairs.push({ promptKey, market: samples[0]?.market ?? null, liked, disliked });
      } else {
        train.push(...samples);
      }
      continue;
    }
    train.push(...samples);
  }

  // The negatives cap, applied once the split is fixed. Dislikes are ranked by how much the listener had
  // to say about them - a named reason teaches something specific, a bare thumbs-down does not - so the
  // ones kept are the informative ones.
  const positives = train.filter((sample) => sample.verdict === 'like');
  const negatives = train.filter((sample) => sample.verdict === 'dislike');
  const negativesAllowed = Math.max(0, positives.length * guards.maxNegativesPerPositive);
  const rankedNegatives = negatives
    .slice()
    .sort((a, b) => b.reasons.length - a.reasons.length || a.createdAt.localeCompare(b.createdAt));
  const negativesKept = new Set(rankedNegatives.slice(0, negativesAllowed).map((sample) => sample.id));
  const negativesDropped = negatives.length - negativesKept.size;
  const keptTrain = train
    .filter((sample) => sample.verdict === 'like' || negativesKept.has(sample.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));


  const anchors = anchorSamples(guards.minAnchors, judgedIds);
  const hash = corpusHash({ train: keptTrain, heldOut: heldOutPairs, anchors, guards });

  const counts: CorpusManifest['counts'] = {
    judged: all.length,
    liked: positives.length + heldOutPairs.reduce((total, pair) => total + pair.liked.length, 0),
    disliked: negatives.length + heldOutPairs.reduce((total, pair) => total + pair.disliked.length, 0),
    train: keptTrain.length,
    heldOutPairs: heldOutPairs.length,
    anchors: anchors.length,
    songs: all.filter((sample) => sample.origin === 'song').length,
    runs: all.filter((sample) => sample.origin === 'run').length,
    withAudio: all.filter((sample) => Boolean(sample.audio)).length,
    negativesDropped,
    evaluationExcluded,
  };

  const byEdition: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  const markets: Record<string, number> = {};
  for (const sample of all) {
    const edition = sample.edition ?? 'unknown';
    byEdition[edition] = (byEdition[edition] ?? 0) + 1;
    markets[sample.market ?? '-'] = (markets[sample.market ?? '-'] ?? 0) + 1;
    for (const reason of sample.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }

  const blockers: string[] = [];
  if (keptTrain.length < guards.minTrainSamples) {
    blockers.push(
      `only ${keptTrain.length} training sample(s) after the split and the negatives cap; ` +
        `${guards.minTrainSamples} are needed before tuning is worth a GPU run`,
    );
  }
  if (anchors.length < guards.minAnchors) {
    blockers.push(
      `only ${anchors.length} anchor(s) from unjudged designs; ${guards.minAnchors} are needed, because a ` +
        'mix that is only feedback drifts onto its own output',
    );
  }
  if (heldOutPairs.length < guards.minHeldOutPairs) {
    blockers.push(
      `only ${heldOutPairs.length} held-out prompt(s) with a liked reference; ` +
        `${guards.minHeldOutPairs} are needed to tell two editions apart, and each one needs a prompt ` +
        'with at least one liked response (a dislike on the same prompt is optional - the judge renders ' +
        'both editions and asks which is closer to the liked render)',
    );
  }

  const { base, ordinal } = tuningBase();
  return {
    hash,
    manifest: {
      hash,
      builtAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      editionOrdinal: ordinal,
      baseId: base?.id ?? null,
      counts,
      byEdition,
      reasons,
      markets,
      guards,
      blockers,
    },
    train: keptTrain,
    heldOut: heldOutPairs,
    anchors,
    all,
  };
}

/** Where a corpus for this ordinal is written: one file per candidate, never overwritten in place. */
export function corpusPath(ordinal: number, hash: string): string {
  const root = config.edition.corpusDir || path.join(path.dirname(config.dbPath), 'editions');
  return path.join(root, `edition-${String(ordinal).padStart(3, '0')}-${hash.slice(0, 10)}.json`);
}

/**
 * Writes the corpus next to the database and returns where it went.
 *
 * The manifest and the samples travel together: an edition row that named a hash and nothing else could
 * not be re-examined later, and re-examining is the only way to explain a model edition after the fact.
 */
export function writeCorpus(corpus: EditionCorpus): string {
  const file = corpusPath(corpus.manifest.editionOrdinal, corpus.hash);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      { manifest: corpus.manifest, train: corpus.train, anchors: corpus.anchors, heldOut: corpus.heldOut },
      null,
      2,
    ),
    'utf-8',
  );
  return file;
}

/** One line per figure that matters, for the CLI and the API. */
export function describeCorpus(corpus: EditionCorpus): string[] {
  const lines: string[] = [];
  const { counts, guards } = corpus.manifest;
  lines.push(
    `corpus ${corpus.hash.slice(0, 10)} for edition #${corpus.manifest.editionOrdinal} ` +
      `(base: ${corpus.manifest.baseId ? corpus.manifest.baseId.slice(0, 8) : 'the base model'})`,
  );
  lines.push(
    `  ${counts.judged} judged response(s) -> ${counts.train} train, ${counts.heldOutPairs} held-out prompt(s)`,
  );
  lines.push(
    `  ${counts.liked} like(s), ${counts.disliked} dislike(s), ${counts.negativesDropped} negative(s) dropped ` +
      `by the ${guards.maxNegativesPerPositive}:1 cap`,
  );
  lines.push(`  ${counts.anchors} anchor(s) from unjudged designs`);
  lines.push(
    `  judged material: ${counts.songs} listener song(s), ${counts.runs} rated render(s) of this loop; ` +
      `${counts.withAudio} with audio the executor can reach`,
  );
  const editions = Object.entries(corpus.manifest.byEdition)
    .map(([edition, n]) => `${edition}:${n}`)
    .join(' ');
  if (editions) lines.push(`  by edition: ${editions}`);
  for (const blocker of corpus.manifest.blockers) lines.push(`  BLOCKED: ${blocker}`);
  return lines;
}

