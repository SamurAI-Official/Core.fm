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
  /** The response: the app's song id, which is how the audio is found. */
  id: string;
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

function judgedSamples(): CorpusSample[] {
  // Evaluation verdicts are excluded: they come from listening to the held-out prompts, and training on
  // them would make the next gate measure memorisation of its own test set.
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT id, verdict, reasons, features, market, source_id, prompt_id, edition, created_at
     FROM feedback
     WHERE source_id IS NOT NULL AND withdrawn = 0 AND role <> 'evaluation'
     ORDER BY created_at ASC, id ASC`,
  );
  return rows.map((row) => ({
    id: String(row.source_id),
    promptKey: row.prompt_id ? String(row.prompt_id) : String(row.source_id),
    market: row.market ? String(row.market) : null,
    verdict: String(row.verdict) as FeedbackVerdict,
    reasons: jsonParse<string[]>(row.reasons, []),
    edition: row.edition ? String(row.edition) : null,
    createdAt: String(row.created_at),
    features: jsonParse<FeedbackFeatures>(row.features, {}),
  }));
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

  const all = judgedSamples();
  const judgedIds = new Set(all.map((sample) => sample.id));
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
      // A pair needs both sides to say anything about preference; a prompt judged only one way is
      // training material, not held-out evidence.
      if (liked.length > 0 && disliked.length > 0) {
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
      `only ${heldOutPairs.length} held-out prompt(s) with both a like and a dislike; ` +
        `${guards.minHeldOutPairs} are needed to tell two editions apart`,
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
  const editions = Object.entries(corpus.manifest.byEdition)
    .map(([edition, n]) => `${edition}:${n}`)
    .join(' ');
  if (editions) lines.push(`  by edition: ${editions}`);
  for (const blocker of corpus.manifest.blockers) lines.push(`  BLOCKED: ${blocker}`);
  return lines;
}

