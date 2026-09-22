/**
 * Forwarding listener verdicts to the signal aggregator.
 *
 * A verdict is stored by this app and, when the song can be attributed to a market, also reported to
 * the aggregator so it can reach the weights that designed the song. The two writes are deliberately
 * independent: the aggregator is a separate local service that may be down, and a listener's thumbs
 * down must not fail because of it. So every failure here is reported, never thrown.
 *
 * Note the asymmetry in what the caller gets back: the aggregator answers with what *it* did, which
 * may be nothing at all - a single listener's vote is recorded and held until enough distinct
 * listeners agree. `applied` and `pending` say which of the two happened.
 */
import { config } from '../config/index.js';

export interface PreferenceReport {
  market: string;
  verdict: 'like' | 'dislike' | 'none';
  /** Opaque id of the listener. Required for the agreement gate and for retraction. */
  rater?: string;
  /** Which response was judged - the song id, so a retraction can find the same verdict again. */
  sourceId?: string;
  reasons?: string[];
  features?: {
    genre?: string;
    bpm?: number;
    keyScale?: string;
    style?: string;
    agent?: string;
    subject?: string;
    language?: string;
    themes?: string[];
  };
  /** `false` records the verdict without letting it move anything. */
  learn?: boolean;
}

export interface PreferenceOutcome {
  ok: boolean;
  /** Serverside error text when the report could not be delivered; the verdict is still stored. */
  error?: string;
  /** Weight keys this verdict moved now, because enough distinct listeners agree. */
  applied: string[];
  /** Keys still short of agreement, with how many listeners are with this one so far. */
  pending: Array<{ key: string; raters: number; needed: number }>;
  /** Set when the verdict retracted an earlier one. */
  withdrawn?: { released: number; reversed: string[] } | null;
  market: string | null;
}

export async function reportPreference(report: PreferenceReport): Promise<PreferenceOutcome> {
  const empty: PreferenceOutcome = { ok: false, applied: [], pending: [], market: report.market };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.aggregator.timeoutMs);
  try {
    const response = await fetch(`${config.aggregator.url}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...report, source: 'app' }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as {
      error?: string;
      applied?: unknown;
      pending?: unknown;
      withdrawn?: unknown;
    };
    if (!response.ok) {
      return { ...empty, error: payload.error ?? `aggregator responded ${response.status}` };
    }
    const pending = Array.isArray(payload.pending)
      ? (payload.pending as Array<{ key?: unknown; raters?: unknown; needed?: unknown }>).map((entry) => ({
          key: String(entry.key),
          raters: Number(entry.raters ?? 0),
          needed: Number(entry.needed ?? 0),
        }))
      : [];
    const withdrawn =
      payload.withdrawn && typeof payload.withdrawn === 'object'
        ? (payload.withdrawn as { released?: unknown; reversed?: unknown })
        : null;
    return {
      ok: true,
      applied: Array.isArray(payload.applied) ? payload.applied.map(String) : [],
      pending,
      withdrawn: withdrawn
        ? {
            released: Number(withdrawn.released ?? 0),
            reversed: Array.isArray(withdrawn.reversed) ? withdrawn.reversed.map(String) : [],
          }
        : null,
      market: report.market,
    };
  } catch (error) {
    // Offline, timing out, or not running: the verdict still stands locally.
    return { ...empty, error: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
