/**
 * Executes designed concepts through the local ACE-Step pipeline:
 * submit -> poll -> download renders -> score -> learn.
 *
 * The pipeline is single-GPU, so execution is serialised and a failed job is
 * recorded with its error rather than aborting the cycle.
 */
import { writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { pipeline } from './client.js';
import { downloadAudio, extensionFor, pollJob, submitConcept } from './submit.js';
import { finishRun, getRun, insertRun, saveScores, setRunJobId, setRunLocalAudio, setRunStage, type RunRecord } from '../loops/store.js';
import { humanScore } from '../loops/ratings.js';
import { learnFromScore, scoreRun } from '../scoring/score.js';
import { latestBrief } from '../briefs/build.js';
import { updateConceptStatus } from '../design/store.js';
import type { Concept } from '../design/types.js';

export interface ExecuteResult {
  runId: string;
  conceptId: string;
  market: string;
  status: 'succeeded' | 'failed';
  error?: string;
  audioPaths: string[];
  verdict?: string;
  marketFit?: number;
  novelty?: number;
  composite?: number;
  learning: string[];
}

export interface ExecuteOptions {
  onEvent?: (message: string) => void;
  /** Called as soon as the run row exists, so callers can return an id to poll. */
  onRunCreated?: (runId: string) => void;
  /** Root directory for downloaded renders (defaults to <db dir>/audio). */
  audioRoot?: string;
  /** Write a per-run manifest next to the audio (default true). */
  writeManifest?: boolean;
}

export async function executeConcept(concept: Concept, options: ExecuteOptions = {}): Promise<ExecuteResult> {
  const log = options.onEvent ?? (() => undefined);
  const audioRoot = options.audioRoot ?? path.join(path.dirname(config.dbPath), 'audio');
  const base: ExecuteResult = {
    runId: '',
    conceptId: concept.id,
    market: concept.market,
    status: 'failed',
    audioPaths: [],
    learning: [],
  };

  const runId = insertRun({ conceptId: concept.id, market: concept.market, iteration: 1, status: 'queued' });
  base.runId = runId;
  updateConceptStatus(concept.id, 'generating');
  options.onRunCreated?.(runId);

  try {
    const token = await pipeline.authenticate();
    const jobId = await submitConcept(concept, token, { runId });
    setRunJobId(runId, jobId);
    setRunStage(runId, 'running', 'queued in the ACE-Step pipeline');
    log(`run ${runId}: submitted as pipeline job ${jobId}`);

    const job = await pollJob(jobId, token, log, (status, stage) => {
      // Persist progress so the UI can show it while the GPU works.
      if (status !== 'succeeded' && status !== 'failed') setRunStage(runId, status, stage);
    });

    if (job.status !== 'succeeded') {
      finishRun(runId, { status: 'failed', error: job.error ?? 'unknown pipeline failure' });
      updateConceptStatus(concept.id, 'failed');
      return { ...base, status: 'failed', error: job.error };
    }

    const audioPaths: string[] = [];
    for (let index = 0; index < job.audioUrls.length; index += 1) {
      const url = job.audioUrls[index];
      const destination = path.join(audioRoot, concept.market, `${runId}_${index}.${extensionFor(url)}`);
      try {
        await downloadAudio(url, destination);
        audioPaths.push(destination);
      } catch (error) {
        log(`  audio ${index + 1} download failed - ${(error as Error).message}`);
      }
    }

    finishRun(runId, {
      status: 'succeeded',
      audioUrls: job.audioUrls,
      duration: job.duration ?? null,
      reportedBpm: job.bpm ?? null,
      reportedKey: job.keyScale ?? null,
      timeSignature: job.timeSignature ?? null,
    });
    setRunLocalAudio(runId, audioPaths);

    if (options.writeManifest !== false) {
      await writeFile(
        path.join(audioRoot, concept.market, `${runId}.json`),
        JSON.stringify(
          {
            runId,
            conceptId: concept.id,
            market: concept.market,
            title: concept.title,
            style: concept.style,
            rationale: concept.rationale,
            /** The narrative arc the lyrics were written to (traceability). */
            lyricArc: concept.params?.lyricArc ?? null,
            lyricArcSummary: concept.params?.lyricArcSummary ?? null,
            requested: { bpm: concept.bpm, key: concept.keyScale, duration: concept.duration },
            pipeline: { jobId, result: { bpm: job.bpm, keyScale: job.keyScale, duration: job.duration } },
            audioPaths,
          },
          null,
          2,
        ),
      );
    }

    // --- scoring ---
    const brief = latestBrief(concept.market);
    if (!brief) {
      log(`run ${runId}: no brief for ${concept.market}, skipping scoring`);
      updateConceptStatus(concept.id, 'generated');
      return { ...base, status: 'succeeded', audioPaths };
    }

    const run = getRun(runId) as RunRecord;
    run.humanScore = humanScore(runId);
    const scored = scoreRun({ run, concept, brief });
    saveScores(runId, {
      marketFit: scored.marketFit,
      novelty: scored.novelty,
      engineScore: run.engineScore,
      composite: scored.composite,
      verdict: scored.verdict,
      breakdown: scored.breakdown as unknown as Record<string, unknown>,
    });
    log(`run ${runId}: marketFit ${scored.marketFit}, novelty ${scored.novelty}, composite ${scored.composite} (${scored.verdict})`);

    // --- learning (human ratings only) ---
    const rated = getRun(runId) as RunRecord;
    rated.humanScore = humanScore(runId);
    const learning = learnFromScore({ market: concept.market, concept, run: rated });
    if (learning.length > 0) log(`run ${runId}: weights updated - ${learning.join(', ')}`);

    updateConceptStatus(concept.id, 'generated');
    return {
      ...base,
      status: 'succeeded',
      audioPaths,
      verdict: scored.verdict,
      marketFit: scored.marketFit,
      novelty: scored.novelty,
      composite: scored.composite,
      learning,
    };
  } catch (error) {
    const message = (error as Error).message || 'unknown pipeline error';
    finishRun(runId, { status: 'failed', error: message });
    updateConceptStatus(concept.id, 'failed');
    return { ...base, status: 'failed', error: message };
  }
}

/** Serialised execution of several concepts (single-GPU pipeline). */
export async function executeConcepts(
  concepts: Concept[],
  options: ExecuteOptions = {},
): Promise<ExecuteResult[]> {
  const results: ExecuteResult[] = [];
  for (const concept of concepts) results.push(await executeConcept(concept, options));
  return results;
}