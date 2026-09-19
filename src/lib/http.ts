/**
 * HTTP helper with timeouts, retries and exponential backoff.
 * Public chart feeds are flaky (Apple's feed occasionally times out), so every
 * outbound call goes through here and a single failure never aborts a cycle.
 */

export class HttpError extends Error {
  status: number;
  url: string;
  body?: string;

  constructor(status: number, url: string, body?: string) {
    super(`HTTP ${status} for ${url}${body ? ` - ${body.slice(0, 200)}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export const USER_AGENT = 'SignalAggregator/0.1 (local research prototype)';

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function backoffMs(attempt: number): number {
  const base = 600 * 2 ** attempt;
  return Math.min(base, 8000) + Math.floor(Math.random() * 250);
}

export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 20000;
  const retries = options.retries ?? 3;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json,text/plain,*/*',
          ...(options.headers ?? {}),
        },
        body: options.body,
        signal: controller.signal,
      });

      if (response.ok) return response;

      const text = await response.text().catch(() => '');
      if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) {
        throw new HttpError(response.status, url, text);
      }
      lastError = new HttpError(response.status, url, text);
    } catch (error) {
      lastError = error;
      const isHttp = error instanceof HttpError;
      if (isHttp && !RETRYABLE_STATUS.has((error as HttpError).status) && attempt === retries) {
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await fetchWithRetry(url, options);
  return (await response.json()) as T;
}

export async function postJson<T>(url: string, payload: unknown, options: FetchOptions = {}): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    body: JSON.stringify(payload),
  });
  return (await response.json()) as T;
}
