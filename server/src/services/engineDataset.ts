/**
 * Calls to the engine's `/v1/dataset/*` endpoints.
 *
 * Those endpoints answer with a wrapper envelope (`{data, code, error}`) and still return HTTP 200 when the
 * operation failed, so the body's `error`/`code` have to be checked, not just the status - a mistake that
 * reads as success and produces an empty tensor directory.
 *
 * Lives here rather than inside the training route because the edition executor needs the same two calls
 * (load, preprocess) and two implementations of "did the engine actually work" would drift.
 */
import { config } from '../config/index.js';

export async function callEngineDataset(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<{ data?: unknown; error?: string }> {
  const response = await fetch(`${config.acestep.apiUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json().catch(() => ({}))) as { data?: unknown; code?: number; error?: string };
  if (!response.ok) {
    return { error: payload.error ?? `${endpoint} failed: HTTP ${response.status}` };
  }
  if (payload.error || (typeof payload.code === 'number' && payload.code >= 400)) {
    return { error: payload.error ?? `${endpoint} failed with code ${payload.code}` };
  }
  return { data: payload.data };
}
