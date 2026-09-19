/**
 * Persistence for generation runs (one row per generated artifact).
 */
import { pool, jsonParse } from '../db/index.js';
import { uuid } from '../lib/util.js';

export interface RunRecord {
  id: string;
  conceptId: string | null;
  market: string;
  iteration: number;
  startedAt: string;
  finishedAt: string | null;
  pipelineJobId: string | null;
  status: string;
  /** Human-readable progress stage while the pipeline is generating. */
  stage: string | null;
  error: string | null;
  audioUrls: string[];
  /** Local copies downloaded into data/audio/<market>/ (paths on this machine). */
  localAudio: string[];
  duration: number | null;
  reportedBpm: number | null;
  reportedKey: string | null;
  timeSignature: string | null;
  marketFit: number | null;
  novelty: number | null;
  engineScore: number | null;
  humanScore: number | null;
  composite: number | null;
  verdict: string | null;
  breakdown: Record<string, unknown>;
}

function optionalNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function mapRun(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    conceptId: row.concept_id ? String(row.concept_id) : null,
    market: String(row.market),
    iteration: Number(row.iteration ?? 1),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    pipelineJobId: row.pipeline_job_id ? String(row.pipeline_job_id) : null,
    status: String(row.status),
    stage: row.stage ? String(row.stage) : null,
    error: row.error ? String(row.error) : null,
    audioUrls: jsonParse<string[]>(row.audio_urls, []),
    localAudio: jsonParse<string[]>(row.local_audio, []),
    duration: optionalNumber(row.duration),
    reportedBpm: optionalNumber(row.reported_bpm),
    reportedKey: row.reported_key ? String(row.reported_key) : null,
    timeSignature: row.time_signature ? String(row.time_signature) : null,
    marketFit: optionalNumber(row.market_fit),
    novelty: optionalNumber(row.novelty),
    engineScore: optionalNumber(row.engine_score),
    humanScore: optionalNumber(row.human_score),
    composite: optionalNumber(row.composite),
    verdict: row.verdict ? String(row.verdict) : null,
    breakdown: jsonParse<Record<string, unknown>>(row.breakdown, {}),
  };
}

export function insertRun(input: {
  conceptId: string | null;
  market: string;
  iteration?: number;
  pipelineJobId?: string | null;
  status?: string;
}): string {
  const id = uuid();
  pool.query(
    `INSERT INTO runs (id, concept_id, market, iteration, pipeline_job_id, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.conceptId, input.market, input.iteration ?? 1, input.pipelineJobId ?? null, input.status ?? 'queued'],
  );
  return id;
}

export function setRunJobId(id: string, pipelineJobId: string): void {
  pool.query('UPDATE runs SET pipeline_job_id = ? WHERE id = ?', [pipelineJobId, id]);
}

export function finishRun(
  id: string,
  patch: {
    status: string;
    error?: string | null;
    audioUrls?: string[];
    duration?: number | null;
    reportedBpm?: number | null;
    reportedKey?: string | null;
    timeSignature?: string | null;
  },
): void {
  pool.query(
    `UPDATE runs SET status = ?, error = ?, audio_urls = ?, duration = ?, reported_bpm = ?,
                     reported_key = ?, time_signature = ?, finished_at = datetime('now')
     WHERE id = ?`,
    [
      patch.status,
      patch.error ?? null,
      JSON.stringify(patch.audioUrls ?? []),
      patch.duration ?? null,
      patch.reportedBpm ?? null,
      patch.reportedKey ?? null,
      patch.timeSignature ?? null,
      id,
    ],
  );
}

export function saveScores(
  id: string,
  patch: {
    marketFit: number;
    novelty: number;
    engineScore: number | null;
    composite: number;
    verdict: string;
    breakdown: Record<string, unknown>;
  },
): void {
  pool.query(
    `UPDATE runs SET market_fit = ?, novelty = ?, engine_score = ?, composite = ?, verdict = ?, breakdown = ?
     WHERE id = ?`,
    [
      patch.marketFit,
      patch.novelty,
      patch.engineScore,
      patch.composite,
      patch.verdict,
      JSON.stringify(patch.breakdown),
      id,
    ],
  );
}

/** Progress update while a job is generating, so clients can show the stage. */
export function setRunStage(id: string, status: string, stage?: string | null): void {
  pool.query('UPDATE runs SET status = ?, stage = ? WHERE id = ?', [status, stage ?? null, id]);
}

/** Persists the downloaded local copies of a run's audio. */
export function setRunLocalAudio(id: string, paths: string[]): void {
  pool.query('UPDATE runs SET local_audio = ? WHERE id = ?', [JSON.stringify(paths), id]);
}

/** Persists the mean human rating onto the run (the market test result). */
export function setRunHumanScore(id: string, score: number | null): void {
  pool.query('UPDATE runs SET human_score = ? WHERE id = ?', [score, id]);
}

export function getRun(id: string): RunRecord | null {
  const { rows } = pool.query<Record<string, unknown>>('SELECT * FROM runs WHERE id = ?', [id]);
  return rows[0] ? mapRun(rows[0]) : null;
}

export function listRuns(options: { market?: string; status?: string; limit?: number } = {}): RunRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.market) {
    clauses.push('market = ?');
    params.push(options.market);
  }
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  params.push(options.limit ?? 50);
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT * FROM runs ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY started_at DESC LIMIT ?`,
    params,
  );
  return rows.map(mapRun);
}