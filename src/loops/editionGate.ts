/**
 * The adoption gate: whether a candidate edition replaces the incumbent.
 *
 * This is the one step in the loop that changes what listeners hear, so it is the one step that has to be
 * conservative, and it is deliberately the simplest thing in the whole system: a candidate is adopted
 * only if it ranks held-out *preference pairs* better than the incumbent does, on prompts neither was
 * trained on. Nothing here is a proxy for quality that the loop can game - the judgement is a listener's,
 * recorded before the candidate existed.
 *
 * The scorer is injected rather than implemented here. Two reasons, and both matter:
 *
 *   - the real scorer means running audio through two editions, which is the executor's job (preprocess,
 *     train, render, score) and cannot live inside a decision module;
 *   - it makes the *protocol* testable offline against a known-good and a known-bad model, which is the
 *     only way to know the gate works before a GPU spends an hour proving it.
 *
 * Five ways this could go wrong are answered explicitly, because each is a way an unsupervised loop makes
 * a confident mistake:
 *
 *   - **too little evidence** - a refusal below `minHeldOutPairs`, rather than a judgement from noise;
 *   - **no improvement** - a tie is a rejection: churning the model for nothing has a cost and no gain;
 *   - **a lucky pair** - accuracy is required, not merely "better than the incumbent on the day";
 *   - **a broken candidate that wins the metric** - the existing quality gates are a precondition, not a
 *     tiebreak;
 *   - **tuning for ever** - after `maxNoWinTrials` rejections the loop halts and asks for a human, because
 *     a loop that keeps trying is a loop that eventually adopts noise.
 */
import { config } from '../config.js';

export interface PreferencePair {
  promptKey: string;
  market: string | null;
  /** Response ids the listener wanted more of, on this prompt. */
  liked: string[];
  /** Response ids they wanted less of, on the same prompt. */
  disliked: string[];
}

/**
 * Scores one response as produced by one edition, higher meaning "a listener would prefer this".
 *
 * Injected on purpose: this module decides, it does not measure.
 */
export type EditionScorer = (editionId: string, sampleId: string) => number;

export interface QualityGates {
  passed: boolean;
  /** What failed, in the words of the gate that failed - carried into the decision either way. */
  failures: string[];
}

export interface GateInput {
  candidateId: string;
  /** The edition in force, or null for the base model. */
  incumbentId: string | null;
  pairs: PreferencePair[];
  score: EditionScorer;
  /** The singability/audio gates that already exist, as a precondition rather than a tiebreak. */
  qualityGates?: QualityGates;
  minHeldOutPairs?: number;
  minWinRate?: number;
  /** Rejections since the last adoption, so the stop rule has something to count. */
  noWinTrials?: number;
  maxNoWinTrials?: number;
}

export interface PairOutcome {
  promptKey: string;
  market: string | null;
  candidateCorrect: boolean;
  incumbentCorrect: boolean;
  /** Which side decided it, for a reader asking "why did this pair count against the candidate". */
  detail: string;
}

export interface GateDecision {
  candidateId: string;
  incumbentId: string | null;
  decision: 'adopt' | 'reject' | 'halt';
  pairs: number;
  wins: number;
  losses: number;
  ties: number;
  /** Decisive win rate: wins / (wins + losses). Null when every pair tied. */
  winRate: number | null;
  candidateAccuracy: number;
  incumbentAccuracy: number;
  /** Every reason, in the order they were considered. Empty only for an adoption. */
  reasons: string[];
  qualityGates: QualityGates;
  trialsAfter: number;
  outcomes: PairOutcome[];
}

/**
 * Does a model rank this listener's preferences correctly on one prompt?
 *
 * A pair counts as correct when the model scores the *worst* liked response above the *best* disliked
 * one: the strict reading of "this listener would rather have had that". A gentler reading (mean above
 * mean) would pass a model that is merely louder on average, which is not the thing being asked.
 */
function judgePair(
  pair: PreferencePair,
  editionId: string,
  score: EditionScorer,
): { correct: boolean; detail: string } {
  const likedScores = pair.liked.map((id) => score(editionId, id));
  const dislikedScores = pair.disliked.map((id) => score(editionId, id));
  if (likedScores.length === 0 || dislikedScores.length === 0) {
    return { correct: false, detail: 'pair is missing a side' };
  }
  const worstLiked = Math.min(...likedScores);
  const bestDisliked = Math.max(...dislikedScores);
  return {
    correct: worstLiked > bestDisliked,
    detail: `liked ${worstLiked.toFixed(3)} vs disliked ${bestDisliked.toFixed(3)}`,
  };
}

export function judgeCandidate(input: GateInput): GateDecision {
  const minPairs = input.minHeldOutPairs ?? config.edition.minHeldOutPairs;
  const minWinRate = input.minWinRate ?? config.edition.minWinRate;
  const maxTrials = input.maxNoWinTrials ?? config.edition.maxNoWinTrials;
  const trials = input.noWinTrials ?? 0;
  const qualityGates = input.qualityGates ?? { passed: true, failures: [] };

  const outcomes: PairOutcome[] = input.pairs.map((pair) => {
    const candidate = judgePair(pair, input.candidateId, input.score);
    const incumbent = input.incumbentId
      ? judgePair(pair, input.incumbentId, input.score)
      : { correct: false, detail: 'no incumbent (base model)' };
    return {
      promptKey: pair.promptKey,
      market: pair.market,
      candidateCorrect: candidate.correct,
      incumbentCorrect: incumbent.correct,
      detail: `candidate: ${candidate.detail} | incumbent: ${incumbent.detail}`,
    };
  });

  const pairs = outcomes.length;
  const wins = outcomes.filter((o) => o.candidateCorrect && !o.incumbentCorrect).length;
  const losses = outcomes.filter((o) => !o.candidateCorrect && o.incumbentCorrect).length;
  const ties = pairs - wins - losses;
  const decisive = wins + losses;
  const winRate = decisive > 0 ? wins / decisive : null;
  const candidateAccuracy = pairs > 0 ? outcomes.filter((o) => o.candidateCorrect).length / pairs : 0;
  const incumbentAccuracy = pairs > 0 ? outcomes.filter((o) => o.incumbentCorrect).length / pairs : 0;

  const reasons: string[] = [];
  if (pairs < minPairs) {
    reasons.push(
      `only ${pairs} held-out pair(s) with both a like and a dislike; ${minPairs} are needed before a ` +
        'candidate can be judged at all',
    );
  }
  if (candidateAccuracy < minWinRate) {
    reasons.push(
      `the candidate ranks ${(candidateAccuracy * 100).toFixed(1)}% of held-out pairs correctly, below the ` +
        `${(minWinRate * 100).toFixed(0)}% required`,
    );
  }
  if (decisive === 0) {
    reasons.push('no pair separated the two editions, so there is nothing to adopt on');
  } else if (wins <= losses) {
    reasons.push(
      `the candidate won ${wins} of ${decisive} decisive pair(s) against the incumbent, which is not an ` +
        'improvement',
    );
  }
  if (!qualityGates.passed) {
    reasons.push(`the quality gates failed: ${qualityGates.failures.join('; ') || 'unspecified'}`);
  }

  const trialsAfter = reasons.length > 0 ? trials + 1 : 0;
  let decision: GateDecision['decision'] = reasons.length === 0 ? 'adopt' : 'reject';
  if (decision === 'reject' && trialsAfter >= maxTrials) {
    decision = 'halt';
    reasons.push(
      `${trialsAfter} candidate(s) in a row have failed to win; the loop stops here rather than tuning ` +
        'against noise - read the corpus and these reasons before starting another',
    );
  }

  return {
    candidateId: input.candidateId,
    incumbentId: input.incumbentId,
    decision,
    pairs,
    wins,
    losses,
    ties,
    winRate,
    candidateAccuracy,
    incumbentAccuracy,
    reasons,
    qualityGates,
    trialsAfter,
    outcomes,
  };
}

/** The decision as the `evaluation` blob an edition row stores: compact, and enough to be reviewed. */
export function decisionRecord(decision: GateDecision): Record<string, unknown> {
  return {
    decision: decision.decision,
    candidateId: decision.candidateId,
    incumbentId: decision.incumbentId,
    pairs: decision.pairs,
    wins: decision.wins,
    losses: decision.losses,
    ties: decision.ties,
    winRate: decision.winRate,
    candidateAccuracy: Number(decision.candidateAccuracy.toFixed(4)),
    incumbentAccuracy: Number(decision.incumbentAccuracy.toFixed(4)),
    qualityGates: decision.qualityGates,
    trialsAfter: decision.trialsAfter,
    reasons: decision.reasons,
    // Per-pair detail is the difference between "it lost" and "it lost on these prompts", so it is stored
    // with the decision rather than recomputed later from a corpus that has since changed.
    outcomes: decision.outcomes,
    judgedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };
}

/** One line per figure that matters, for the CLI and the API. */
export function describeDecision(decision: GateDecision): string[] {
  const lines: string[] = [];
  const rate = decision.winRate === null ? 'n/a' : `${(decision.winRate * 100).toFixed(1)}%`;
  lines.push(
    `${decision.decision.toUpperCase()}: candidate ${decision.candidateId.slice(0, 8)} vs ` +
      `${decision.incumbentId ? decision.incumbentId.slice(0, 8) : 'the base model'}`,
  );
  lines.push(
    `  ${decision.pairs} pair(s): ${decision.wins} won, ${decision.losses} lost, ${decision.ties} tied ` +
      `(win rate ${rate} of decisive pairs)`,
  );
  lines.push(
    `  accuracy on held-out pairs: candidate ${(decision.candidateAccuracy * 100).toFixed(1)}%, ` +
      `incumbent ${(decision.incumbentAccuracy * 100).toFixed(1)}%`,
  );
  for (const reason of decision.reasons) lines.push(`  ${reason}`);
  return lines;
}

