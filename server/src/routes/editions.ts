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
 *
 * `/execute/plan` and `/execute` are the other half: building the dataset a candidate trains on. The plan is
 * read-only and always safe to call; the run refuses at the first guard and needs `confirm` before it reaches
 * the point of occupying the engine.
 */
import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { judgeComparisons } from '../services/editionJudge.js';
import { planExecution, runExecution } from '../services/editionExecutor.js';
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
 * What the executor would do, without doing any of it.
 *
 * Always safe to call, and the intended first step: it names every guard that would refuse a run, every
 * sample it could not find audio for, what would be written and which engine calls would follow. A refusal
 * here is information, not a failure - the loop being un-trainable is a state (17.17) and the whole point is
 * that it says so instead of training on whatever it happens to find.
 */
router.get('/execute/plan', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const datasetName = typeof req.query.datasetName === 'string' ? req.query.datasetName : undefined;
    const plan = await planExecution({ datasetName });
    res.json({
      corpusHash: plan.corpusHash,
      corpusOrdinal: plan.corpusOrdinal,
      baseId: plan.baseId,
      resumeCheckpoint: plan.resumeCheckpoint,
      counts: plan.counts,
      trainable: plan.blockers.length === 0,
      blockers: plan.blockers,
      samples: {
        resolved: plan.resolved.map((sample) => ({ id: sample.id, origin: sample.origin, file: sample.file })),
        unresolved: plan.unresolved.map((sample) => ({ id: sample.id, origin: sample.origin, missing: sample.missing })),
      },
      would: plan.would,
    });
  } catch (error) {
    // Unreachable aggregator, or no corpus: reported as such rather than as a 500 with a stack.
    res.status(503).json({ error: (error as Error).message });
  }
});

/**
 * Build the dataset, and preprocess it.
 *
 * `confirm` is what allows the run to reach the point of occupying the engine; without it this stops just
 * before that and says so, which is the useful half to exercise while checking the pipeline. Training itself
 * is never started from here - the response names the `/api/training/start` call to make, with the tensor
 * directory and checkpoint this plan chose, so the expensive step stays a deliberate act.
 */
router.post('/execute', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      datasetName?: unknown;
      confirm?: unknown;
      dryRun?: unknown;
      allowPartial?: unknown;
    };
    // Default to the safe direction: `dryRun` is honoured explicitly, and anything that is not `confirm:
    // true` is treated as "stop before training".
    const dryRun = body.dryRun === true;
    if (dryRun) {
      const plan = await planExecution({
        datasetName: typeof body.datasetName === 'string' ? body.datasetName : undefined,
      });
      res.json({ dryRun: true, trainable: plan.blockers.length === 0, blockers: plan.blockers, would: plan.would });
      return;
    }
    const result = await runExecution({
      datasetName: typeof body.datasetName === 'string' ? body.datasetName : undefined,
      confirm: body.confirm === true,
      allowPartial: body.allowPartial === true,
    });
    res.json({ dryRun: false, ...result });
  } catch (error) {
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
