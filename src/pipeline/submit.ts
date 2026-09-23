/**
 * Pipeline job submission and polling for a designed concept.
 */
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { fetchWithRetry } from '../lib/http.js';
import { sleep } from '../lib/util.js';
import { pipeline } from './client.js';
import { currentOrdinal } from '../loops/editions.js';
import type { Concept } from '../design/types.js';

export interface JobResult {
  jobId: string;
  status: string;
  error?: string;
  audioUrls: string[];
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
}

/**
 * Maps a concept to the ace-step-ui generation payload.
 *
 * The last block is *attribution*, not generation: which market this response answers, which concept
 * and run it belongs to, and the lyric-side choices that shaped it. The engine ignores all of it (the
 * UI builds the Gradio argument list from a fixed list of names), but the UI stores the request
 * verbatim on every song it creates - so a verdict on one of these songs can be attributed back to the
 * market and to the writing style, subject and language that produced it, which is what makes a
 * dislike on a *rendered* song learnable at all.
 */
export function conceptToBody(concept: Concept, attribution?: { runId?: string }): Record<string, unknown> {
  const params = concept.params ?? {};
  return {
    customMode: true,
    style: concept.style,
    lyrics: concept.lyrics,
    title: concept.title,
    instrumental: concept.instrumental,
    vocalLanguage: concept.vocalLanguage,
    duration: concept.duration,
    bpm: concept.bpm,
    keyScale: concept.keyScale,
    timeSignature: concept.timeSignature,
    thinking: concept.thinking,
    batchSize: concept.batchSize || config.design.batchSize,
    inferenceSteps: config.design.inferenceSteps,
    guidanceScale: config.design.guidanceScale,
    audioFormat: config.design.audioFormat,
    seed: concept.seed,
    randomSeed: false,
    // --- attribution ---
    market: concept.market,
    conceptId: concept.id,
    runId: attribution?.runId,
    /**
     * Which model edition is in force. This is the provenance the whole soft-tuning loop turns on: a
     * verdict on a response is only trainable evidence *for* the edition that produced it, so the response
     * has to carry the edition and the verdict has to come back with it.
     */
    edition: currentOrdinal(),
    primaryGenre: concept.primaryGenre,
    lyricAgent: typeof params.lyricAgent === 'string' ? params.lyricAgent : undefined,
    lyricSubject: typeof params.lyricSubject === 'string' ? params.lyricSubject : undefined,
    lyricLanguage: concept.vocalLanguage,
    lyricThemes: Array.isArray(params.lyricThemes) ? params.lyricThemes : undefined,
    designSeed: concept.seed,
  };
}

export async function submitConcept(
  concept: Concept,
  token: string,
  attribution?: { runId?: string },
): Promise<string> {
  const response = await fetchWithRetry(`${pipeline.baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(conceptToBody(concept, attribution)),
    timeoutMs: 60000,
    retries: 1,
  });
  const payload = (await response.json()) as { jobId?: string; error?: string };
  if (!payload.jobId) throw new Error(payload.error ?? 'pipeline did not return a jobId');
  return payload.jobId;
}

/** Polls a job until it finishes or the configured timeout is reached. */
export async function pollJob(
  jobId: string,
  token: string,
  onEvent: (message: string) => void,
  onProgress?: (status: string, stage: string | null) => void,
): Promise<JobResult> {
  const deadline = Date.now() + config.pipeline.timeoutMs;
  let status = 'queued';
  let payload: Record<string, unknown> = {};

  while (Date.now() < deadline) {
    await sleep(config.pipeline.pollMs);
    const response = await fetchWithRetry(`${pipeline.baseUrl}/api/generate/status/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 30000,
      retries: 2,
    });
    payload = (await response.json()) as Record<string, unknown>;
    status = String(payload.status ?? 'unknown');
    const stage = payload.stage ? String(payload.stage) : null;
    onProgress?.(status, stage);
    if (status === 'succeeded' || status === 'failed') break;
    onEvent(`  ${status}${stage ? ` - ${stage}` : ''}`);
  }

  const result = (payload.result ?? {}) as {
    audioUrls?: string[];
    duration?: number;
    bpm?: number;
    keyScale?: string;
    timeSignature?: string;
  };

  return {
    jobId,
    status,
    error: payload.error ? String(payload.error) : status !== 'succeeded' ? `job ended with status '${status}'` : undefined,
    audioUrls: result.audioUrls ?? [],
    duration: result.duration,
    bpm: result.bpm,
    keyScale: result.keyScale,
    timeSignature: result.timeSignature,
  };
}

export function extensionFor(urlPath: string, fallback = 'mp3'): string {
  const match = urlPath.match(/\.(mp3|flac|wav|ogg|m4a)(\?|$)/i);
  return match ? match[1].toLowerCase() : fallback;
}

/** Downloads a rendered file from the UI backend to local storage. */
export async function downloadAudio(urlPath: string, destination: string): Promise<void> {
  const url = urlPath.startsWith('http') ? urlPath : `${pipeline.baseUrl}${urlPath}`;
  const response = await fetchWithRetry(url, { timeoutMs: 60000, retries: 2 });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error(`empty audio download from ${url}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, buffer);
}