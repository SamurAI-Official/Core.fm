/**
 * Edition judging, from the app's side.
 *
 * The aggregator owns the gate: it decides whether a candidate edition replaces the one in force, and it
 * does that from verdicts on renders. What it cannot do is *compare audio* - the renders live here, next to
 * the GPU and the storage - so this is where a comparison happens and where its result is reported back in
 * the form the loop already understands: a like on the preferred render, a dislike on the other, marked as
 * evaluation evidence.
 *
 * A person can do the same thing with the ordinary dislike button on the two renders; this route exists so
 * an automated judge can do it in bulk, and so the provenance of each judgement is recorded (`source`:
 * `edition-proxy`) rather than being indistinguishable from an ear.
 */
import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { judgeComparisons } from '../services/editionJudge.js';
import { config } from '../config/index.js';

const router = Router();

/** The aggregator's registry, so a UI (or a script) can see what is in force without knowing its URL. */
router.get('/', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const response = await fetch(`${config.aggregator.url}/api/editions`, {
      signal: AbortSignal.timeout(config.aggregator.timeoutMs),
    });
    const payload = (await response.json()) as Record<string, unknown>;
    res.status(response.status).json(payload);
  } catch (error) {
    // The loop being unreachable is not an error in this app: nothing here depends on it.
    res.status(503).json({ error: (error as Error).message });
  }
});

/**
 * Judge rendered comparisons and report them as evaluation verdicts.
 *
 * `comparisons` is one entry per held-out prompt: where the listener's liked material is, and where the two
 * editions' renders are. The response says what each comparison found - including the similarities, so a
 * decision can be traced to the numbers behind it - and reports failures per prompt rather than turning them
 * into ties.
 */
router.post('/judge', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      candidateOrdinal?: unknown;
      incumbentOrdinal?: unknown;
      comparisons?: unknown;
      reportTies?: unknown;
    };
    if (typeof body.candidateOrdinal !== 'number' || typeof body.incumbentOrdinal !== 'number') {
      res.status(400).json({ error: 'candidateOrdinal and incumbentOrdinal (numbers) are required' });
      return;
    }
    if (!Array.isArray(body.comparisons) || body.comparisons.length === 0) {
      res.status(400).json({ error: 'comparisons must be a non-empty list of prompt comparisons' });
      return;
    }

    const comparisons = (body.comparisons as Array<Record<string, unknown>>).map((item, index) => {
      const promptKey = typeof item.promptKey === 'string' && item.promptKey ? item.promptKey : `prompt-${index}`;
      return {
        promptKey,
        likedFiles: Array.isArray(item.likedFiles) ? item.likedFiles.map(String) : [],
        candidateFile: String(item.candidateFile ?? ''),
        incumbentFile: String(item.incumbentFile ?? ''),
        candidateSampleId: typeof item.candidateSampleId === 'string' ? item.candidateSampleId : `${promptKey}-candidate`,
        incumbentSampleId: typeof item.incumbentSampleId === 'string' ? item.incumbentSampleId : `${promptKey}-incumbent`,
      };
    });
    const incomplete = comparisons.filter(
      (item) => item.likedFiles.length === 0 || !item.candidateFile || !item.incumbentFile,
    );
    if (incomplete.length > 0) {
      res.status(400).json({
        error: 'every comparison needs likedFiles, candidateFile and incumbentFile',
        prompts: incomplete.map((item) => item.promptKey),
      });
      return;
    }

    const report = await judgeComparisons({
      candidateOrdinal: body.candidateOrdinal,
      incumbentOrdinal: body.incumbentOrdinal,
      comparisons,
      reportTies: body.reportTies === true,
      rater: `app:${req.user!.id}`,
    });
    res.json(report);
  } catch (error) {
    console.error('Edition judge error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
