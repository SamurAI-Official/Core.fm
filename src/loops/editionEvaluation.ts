/**
 * Judging a candidate edition by listening to it.
 *
 * The rule that governs the market weights governs adoption too: **a model grading its own output is not
 * evidence**. So an edition is not adopted on a loss curve, on an embedding distance, or on the engine's
 * own quality signals. It is adopted by rendering the held-out prompts through both editions and asking
 * the listener which one they would rather have - the same judgement, by the same person, that selected
 * the material it would be trained on.
 *
 * It costs a GPU render per held-out prompt per edition, which is why this is a project rather than a
 * script. What it buys is that the number the loop optimises cannot be gamed by the loop.
 *
 * How a listening test becomes the gate's inputs: the harness renders each held-out prompt twice (once
 * under the incumbent, once under the candidate), the listener likes the better one and dislikes the
 * worse, and each render carries the edition that produced it. A prompt where the *liked* render and the
 * *disliked* render came from different editions is a decided pair; a prompt judged only one way, or where
 * both renders came from the same edition, says nothing about the difference between them.
 *
 * The scorer that falls out of that is deliberately trivial - the believed winner scores 1, the loser 0 -
 * because the gate's job is to compare *listener preference*, and anything more expressive would be
 * inventing a signal nobody gave it.
 */
import { pool } from '../db/index.js';
import { config } from '../config.js';
import type { EditionScorer, PreferencePair } from './editionGate.js';

export interface EvaluationPair extends PreferencePair {
  /** Which edition each side came from, so a decision can be read without another query. */
  likedEdition: string | null;
  dislikedEdition: string | null;
}

export interface EvaluationEvidence {
  pairs: EvaluationPair[];
  /** sample id -> edition that produced it, which is what makes the trivial scorer honest. */
  editions: Record<string, string>;
  /** Prompts where both renders came from one edition: judged, but not a comparison. */
  ambiguous: number;
  /** Prompts already rendered under both editions and waiting for a second judgement. */
  pending: number;
}

/**
 * The id the gate compares against for renders made with no adapter.
 *
 * A song records the *ordinal* in force (0 = the base model) because that is the stable, human-readable
 * provenance. The gate compares *ids* from the registry. This is the join between them, and it exists
 * because the first version of this module did not have it: the scorer compared an ordinal (`'0'`) with a
 * candidate's UUID, so nothing ever matched, every pair tied, and a candidate the listener clearly
 * preferred was refused as "no improvement". A silent tie is exactly the failure a gate must not have.
 */
export const BASE_EDITION_ID = 'base';

/** Maps a recorded ordinal to the id the gate works in: 'base' for 0, otherwise the edition's id. */
export function editionIdForOrdinal(ordinal: string): string {
  if (ordinal === '0' || ordinal === '' || ordinal === 'base') return BASE_EDITION_ID;
  const { rows } = pool.query<Record<string, unknown>>('SELECT id FROM editions WHERE ordinal = ?', [
    Number(ordinal),
  ]);
  return rows[0] ? String(rows[0].id) : `ordinal:${ordinal}`;
}

/** Verdicts given on evaluation renders: evidence about two editions, never training material. */
export function evaluationEvidence(): EvaluationEvidence {
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT verdict, source_id, prompt_id, edition
     FROM feedback
     WHERE role = 'evaluation' AND source_id IS NOT NULL AND withdrawn = 0
     ORDER BY created_at ASC`,
  );

  const byPrompt = new Map<string, Array<{ verdict: string; id: string; edition: string | null }>>();
  const editions: Record<string, string> = {};
  const resolved = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.source_id);
    const raw = row.edition ? String(row.edition) : null;
    // Resolve the ordinal a song recorded into the registry id the gate compares, once per ordinal.
    let edition: string | null = null;
    if (raw !== null) {
      if (!resolved.has(raw)) resolved.set(raw, editionIdForOrdinal(raw));
      edition = resolved.get(raw) as string;
    }
    if (edition) editions[id] = edition;
    const key = row.prompt_id ? String(row.prompt_id) : id;
    const list = byPrompt.get(key) ?? [];
    list.push({ verdict: String(row.verdict), id, edition });
    byPrompt.set(key, list);
  }

  const pairs: EvaluationPair[] = [];
  let ambiguous = 0;
  let pending = 0;
  for (const [promptKey, verdicts] of byPrompt.entries()) {
    const liked = verdicts.filter((entry) => entry.verdict === 'like');
    const disliked = verdicts.filter((entry) => entry.verdict === 'dislike');
    const distinct = new Set(verdicts.map((entry) => entry.edition).filter(Boolean));

    if (liked.length === 0 || disliked.length === 0) {
      // Rendered under both editions but only judged once: work in flight, and reporting it is what stops
      // "no decision" looking like "nothing to do".
      if (distinct.size > 1) pending += 1;
      continue;
    }

    const likedEdition = liked[0].edition;
    const dislikedEdition = disliked[0].edition;
    if (!likedEdition || !dislikedEdition || likedEdition === dislikedEdition) {
      // Both sides from one edition: the listener had a preference, but not between the two editions, so
      // this cannot decide anything about them.
      ambiguous += 1;
      continue;
    }
    pairs.push({
      promptKey,
      market: null,
      liked: liked.map((entry) => entry.id),
      disliked: disliked.map((entry) => entry.id),
      likedEdition,
      dislikedEdition,
    });
  }

  return { pairs, editions, ambiguous, pending };
}

/**
 * The scorer a listening test implies: an edition scores 1 on the response it produced and 0 on any other.
 *
 * Written out rather than inlined so the reasoning is in one place - the gate asks "does the candidate
 * rank the liked response above the disliked one", and for a listening test that is exactly "did the
 * listener prefer the candidate's render", which this reduces to.
 */
export function listenerScorer(editions: Record<string, string>): EditionScorer {
  return (editionId: string, sampleId: string): number => (editions[sampleId] === editionId ? 1 : 0);
}

/** How the evidence reads, for the CLI and the API. */
export function describeEvidence(evidence: EvaluationEvidence): string[] {
  const lines: string[] = [];
  lines.push(
    `${evidence.pairs.length} decided pair(s) from listening; ${evidence.ambiguous} prompt(s) judged on one ` +
      `edition only, ${evidence.pending} still waiting for a second judgement`,
  );
  for (const pair of evidence.pairs) {
    lines.push(
      `  ${pair.promptKey.slice(0, 8)}: liked ${pair.likedEdition?.slice(0, 8) ?? '?'} over ` +
        `${pair.dislikedEdition?.slice(0, 8) ?? '?'}`,
    );
  }
  return lines;
}

export interface EvaluationPlan {
  candidateId: string;
  incumbentId: string | null;
  /** The held-out prompts to render under both editions, with the responses already judged on them. */
  prompts: Array<{ promptKey: string; market: string | null; liked: string[]; disliked: string[] }>;
  evidence: { decidedPairs: number; ambiguous: number; pending: number };
  /** What the harness has to do, in order - the two failure points are rendering one edition only, and
   * judging one of the two renders, so both are named. */
  steps: string[];
  /** Below this many decided pairs the gate refuses to judge, so it is worth knowing up front. */
  minHeldOutPairs: number;
}

/**
 * The work a listening test has to do, shared by the API and the CLI so the two cannot describe it
 * differently - a plan that disagreed with the gate's own thresholds would be worse than no plan.
 */
export function evaluationPlan(
  candidateId: string,
  incumbentId: string | null,
  heldOut: Array<{ promptKey: string; market: string | null; liked: Array<{ id: string }>; disliked: Array<{ id: string }> }>,
): EvaluationPlan {
  const evidence = evaluationEvidence();
  const incumbentLabel = incumbentId ? `edition ${incumbentId}` : 'the base model';
  return {
    candidateId,
    incumbentId,
    prompts: heldOut.map((pair) => ({
      promptKey: pair.promptKey,
      market: pair.market,
      liked: pair.liked.map((sample) => sample.id),
      disliked: pair.disliked.map((sample) => sample.id),
    })),
    evidence: {
      decidedPairs: evidence.pairs.length,
      ambiguous: evidence.ambiguous,
      pending: evidence.pending,
    },
    steps: [
      `render each prompt under ${incumbentLabel} and under candidate ${candidateId}, same seed, keeping the audio`,
      "present each prompt's two renders unlabelled, then record a like on the preferred one and a dislike on the other with role=evaluation",
      `POST /api/editions/${candidateId}/evaluate - the gate decides from those verdicts, not from anything else`,
    ],
    minHeldOutPairs: config.edition.minHeldOutPairs,
  };
}

