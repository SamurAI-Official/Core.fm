/**
 * The automated judge: render comparisons turned into verdicts the loop already understands.
 *
 * This is the cheaper half of the listening test. Instead of a person comparing two renders, a spectral
 * distance asks which one is closer to the material that listener liked on that prompt - and then *says so
 * in the same form a person would*: a like on the winner, a dislike on the loser, marked
 * `role: 'evaluation'` and `source: 'edition-proxy'`.
 *
 * Using the same form matters more than it looks. The whole path downstream - the evidence, the pairs, the
 * gate, the corpus-exclusion guard, the provenance recorded with the decision - is unchanged, so a person
 * can override any single judgement by hand, replacing a proxy verdict with their own, and nothing else has
 * to know. It also means a decision can be read with its provenance: `source` says whether an adoption
 * rested on an ear or on a measurement.
 *
 * What this cannot do, stated where the code is rather than only in the docs: a spectral distance cannot
 * tell whether a render is *good* - it can only say which of two is nearer to what was liked, and blandness
 * sits near the middle of any such space. It is therefore only ever used to compare two renders of the same
 * prompt, the gate still demands a win rate and the quality gates, and the distance is expected to be
 * validated against real listening before anyone trusts it for an adoption.
 */
import { compareRenders, type RenderComparison } from './audioFingerprint.js';
import { reportPreference } from './aggregator.js';

export interface PromptComparison {
  /** The prompt both renders answer: one judgement per prompt. */
  promptKey: string;
  /** Files the listener liked on this prompt - the reference the renders are compared against. */
  likedFiles: string[];
  /** The render made by the candidate edition, and the one made by the edition in force. */
  candidateFile: string;
  incumbentFile: string;
  /** Ids to report the verdicts under (the rendered songs, when the harness has them). */
  candidateSampleId: string;
  incumbentSampleId: string;
}

export interface JudgeReport {
  judged: number;
  ties: number;
  /** Prompts the candidate won, which is what the gate counts. */
  candidateWins: number;
  incumbentWins: number;
  reported: number;
  errors: string[];
  comparisons: Array<{ promptKey: string; comparison: RenderComparison }>;
}

/**
 * Judges comparisons and reports them, returning a per-prompt account either way.
 *
 * A comparison that cannot be made - a missing file, an unreadable one - is *reported* and skipped rather
 * than counted as a tie: a tie is a measurement that found nothing, and a failure is no measurement at all.
 * Silently turning the second into the first would quietly weaken every evaluation.
 */
export async function judgeComparisons(input: {
  candidateOrdinal: number;
  incumbentOrdinal: number;
  comparisons: PromptComparison[];
  rater?: string;
  /** A tie is not reported: the gate needs a preference, and a coin toss is not one. */
  reportTies?: boolean;
}): Promise<JudgeReport> {
  const report: JudgeReport = {
    judged: 0,
    ties: 0,
    candidateWins: 0,
    incumbentWins: 0,
    reported: 0,
    errors: [],
    comparisons: [],
  };

  for (const item of input.comparisons) {
    let comparison: RenderComparison;
    try {
      comparison = compareRenders({
        likedFiles: item.likedFiles,
        candidateFile: item.candidateFile,
        incumbentFile: item.incumbentFile,
      });
    } catch (error) {
      report.errors.push(`${item.promptKey}: ${(error as Error).message}`);
      continue;
    }
    report.judged += 1;
    report.comparisons.push({ promptKey: item.promptKey, comparison });
    if (comparison.winner === 'candidate') report.candidateWins += 1;
    if (comparison.winner === 'incumbent') report.incumbentWins += 1;
    if (comparison.winner === 'tie') {
      report.ties += 1;
      if (input.reportTies !== true) continue;
    }

    const winnerIsCandidate = comparison.winner === 'candidate';
    const winner = {
      sampleId: winnerIsCandidate ? item.candidateSampleId : item.incumbentSampleId,
      ordinal: winnerIsCandidate ? input.candidateOrdinal : input.incumbentOrdinal,
    };
    const loser = {
      sampleId: winnerIsCandidate ? item.incumbentSampleId : item.candidateSampleId,
      ordinal: winnerIsCandidate ? input.incumbentOrdinal : input.candidateOrdinal,
    };

    for (const [verdict, side] of [
      ['like', winner],
      ['dislike', loser],
    ] as const) {
      const outcome = await reportPreference({
        market: '',
        verdict,
        rater: input.rater ?? 'edition-proxy',
        sourceId: side.sampleId,
        promptId: item.promptKey,
        edition: String(side.ordinal),
        role: 'evaluation',
        // The provenance of the judgement, not of the render: this is how a decision can later say it was
        // reached by measurement rather than by an ear.
        source: 'edition-proxy',
      });
      if (outcome.ok) report.reported += 1;
      else if (outcome.error && !report.errors.includes(outcome.error)) report.errors.push(outcome.error);
    }
  }

  return report;
}
