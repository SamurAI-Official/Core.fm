/**
 * Creating a generation job.
 *
 * Extracted from the `/api/generate` route so the retry path (a listener saying "not this one" and
 * asking for another take) runs through *exactly* the same code: same job row, same engine call, same
 * `acestep_task_id` update. A second copy of those three statements is how the two paths would drift,
 * and a retry that queued a job differently from a first attempt would be a bug nobody would look for.
 */
import { pool } from '../db/pool.js';
import { generateUUID } from '../db/sqlite.js';
import { generateMusicViaAPI, type GenerationParams } from './acestep.js';

export interface CreatedJob {
  jobId: string;
  acestepTaskId: string;
}

export async function createGenerationJob(userId: string, params: GenerationParams): Promise<CreatedJob> {
  const jobId = generateUUID();
  await pool.query(
    `INSERT INTO generation_jobs (id, user_id, status, params, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, datetime('now'), datetime('now'))`,
    [jobId, userId, JSON.stringify(params)],
  );

  const { jobId: acestepTaskId } = await generateMusicViaAPI(params);

  await pool.query(
    `UPDATE generation_jobs SET acestep_task_id = ?, status = 'running', updated_at = datetime('now') WHERE id = ?`,
    [acestepTaskId, jobId],
  );

  return { jobId, acestepTaskId };
}
