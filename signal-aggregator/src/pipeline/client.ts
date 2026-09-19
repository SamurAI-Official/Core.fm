/**
 * Client for the local ACE-Step pipeline (the running ace-step-ui backend).
 *
 * Contract (verified against the installed build):
 *   GET  /api/auth/auto              -> 404 until a local user exists
 *   POST /api/auth/setup {username}  -> { user, token }
 *   GET  /api/generate/health        -> { healthy, aceStepUrl }   (no auth)
 *   POST /api/generate               -> { jobId }                 (auth required)
 *   GET  /api/generate/status/:jobId -> { status, result, error } (auth required)
 *   GET  /audio/<file>               -> rendered audio bytes
 *
 * Note: the HTTP route forwards a fixed param list and does not include
 * `enhance`, so CoT enrichment is driven by `thinking` (supported).
 */
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { fetchJson, postJson, fetchWithRetry } from '../lib/http.js';
import { getMeta, setMeta } from '../sources/store.js';
import { sleep } from '../lib/util.js';

export interface PipelineHealth {
  ok: boolean;
  url: string;
  detail?: string;
}

export interface PipelineSpec {
  title: string;
  style: string;
  lyrics: string;
  instrumental: boolean;
  vocalLanguage?: string;
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  thinking?: boolean;
  batchSize?: number;
  inferenceSteps?: number;
  guidanceScale?: number;
  audioFormat?: 'mp3' | 'flac';
  customMode?: boolean;
  songDescription?: string;
}

export interface PipelineResult {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage?: string;
  error?: string;
  result?: {
    audioUrls: string[];
    duration?: number;
    bpm?: number;
    keyScale?: string;
    timeSignature?: string;
  };
}

interface AuthResponse {
  user: { id: string; username: string };
  token: string;
}

const TOKEN_META_KEY = 'pipeline_token';

export class PipelineClient {
  readonly baseUrl: string;
  private username: string;
  private token: string | null = null;

  constructor(baseUrl = config.pipeline.baseUrl, username = config.pipeline.username) {
    this.baseUrl = baseUrl;
    this.username = username;
  }

  /** Is the UI backend up, and can it reach the ACE-Step engine? */
  async health(): Promise<PipelineHealth> {
    try {
      const response = await fetchJson<{ healthy: boolean; aceStepUrl?: string; error?: string }>(
        `${this.baseUrl}/api/generate/health`,
        { timeoutMs: 15000, retries: 1 },
      );
      return { ok: response.healthy === true, url: response.aceStepUrl ?? '', detail: response.error };
    } catch (error) {
      return { ok: false, url: '', detail: (error as Error).message };
    }
  }

  /** Loads the cached token, falling back to auto-login / bootstrap. */
  async authenticate(): Promise<string> {
    if (this.token) return this.token;

    const cached = getMeta(TOKEN_META_KEY);
    if (cached) {
      this.token = cached;
      return cached;
    }

    // A local single-user install already has a user: reuse it.
    try {
      const auto = await fetchJson<AuthResponse>(`${this.baseUrl}/api/auth/auto`, {
        timeoutMs: 15000,
        retries: 0,
      });
      this.cacheToken(auto.token);
      return auto.token;
    } catch {
      // Fall through: create this service's own account.
    }

    const created = await postJson<AuthResponse>(
      `${this.baseUrl}/api/auth/setup`,
      { username: this.username },
      { timeoutMs: 15000, retries: 1 },
    );
    this.cacheToken(created.token);
    return created.token;
  }

  private cacheToken(token: string): void {
    this.token = token;
    setMeta(TOKEN_META_KEY, token);
  }

  /** Clears the cached token (used when the pipeline rejects it). */
  resetToken(): void {
    this.token = null;
    setMeta(TOKEN_META_KEY, '');
  }

  async models(): Promise<Array<{ name: string; is_active: boolean; is_preloaded: boolean }>> {
    try {
      const response = await fetchJson<{ models: Array<{ name: string; is_active: boolean; is_preloaded: boolean }> }>(
        `${this.baseUrl}/api/generate/models`,
        { timeoutMs: 20000, retries: 1 },
      );
      return response.models ?? [];
    } catch {
      return [];
    }
  }
}

export const pipeline = new PipelineClient();