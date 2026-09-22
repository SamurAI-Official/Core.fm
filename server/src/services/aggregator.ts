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
  /** Keys it moved in the *listener's own* profile, immediately - no agreement needed. */
  profile: string[];
  /** Keys still short of agreement, with how many listeners are with this one so far. */
  pending: Array<{ key: string; raters: number; needed: number }>;
  /** Set when the verdict retracted an earlier one. */
  withdrawn?: { released: number; reversed: string[] } | null;
  market: string | null;
}

export async function reportPreference(report: PreferenceReport): Promise<PreferenceOutcome> {
  const empty: PreferenceOutcome = { ok: false, applied: [], profile: [], pending: [], market: report.market };
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
      profile?: unknown;
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
      profile: Array.isArray(payload.profile) ? payload.profile.map(String) : [],
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

// ---------------------------------------------------------------------------
// Layer U: the listener's own profile, and what a retry should change
// ---------------------------------------------------------------------------

export interface UserProfileSummary {
  rater: string;
  /** How many verdicts this profile is built from - the honest measure of how much to trust it. */
  verdicts: number;
  prefers: Array<{ key: string; value: number }>;
  avoids: Array<{ key: string; value: number }>;
  updatedAt: string | null;
}

/**
 * This listener's own profile.
 *
 * Returns `ok: false` rather than throwing when the aggregator is not running: a profile is an
 * enhancement, and the Create tab has to work without one. The caller decides how thin is too thin -
 * `verdicts` is reported for exactly that.
 */
export async function fetchProfile(
  rater: string,
  market?: string,
): Promise<{ ok: boolean; error?: string; profile: UserProfileSummary | null }> {
  const url = new URL(`${config.aggregator.url}/api/users/${encodeURIComponent(rater)}/profile`);
  if (market) url.searchParams.set('market', market);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.aggregator.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, error: `aggregator responded ${response.status}`, profile: null };
    const payload = (await response.json()) as UserProfileSummary;
    return { ok: true, profile: payload };
  } catch (error) {
    return { ok: false, error: (error as Error).message, profile: null };
  } finally {
    clearTimeout(timer);
  }
}

export interface NextTakeRequest {
  rater: string;
  reasons: string[];
  /** The params of the take being retried, verbatim. */
  previous: Record<string, unknown>;
  excludeSeeds: number[];
  attempt?: number;
}

export interface NextTakePlan {
  seed: number;
  patch: {
    bpm?: number;
    keyScale?: string;
    style?: string;
    lyricAgent?: string;
    lyricSubject?: string;
  };
  note: string[];
  excluded: number[];
  unactionable: string[];
  machineDesigned: boolean;
}

/**
 * Asks the aggregator what to change, because it owns the vocabularies (genres, production tags,
 * writing styles) and the listener's profile. A failure here is reported, never fatal: a retry that
 * cannot get an opinion still deserves a different take, and the caller falls back to a fresh seed.
 */
export async function planNextTake(
  request: NextTakeRequest,
): Promise<{ ok: boolean; error?: string; plan: NextTakePlan | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.aggregator.timeoutMs);
  try {
    const response = await fetch(`${config.aggregator.url}/api/next-take`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const payload = (await response.json()) as NextTakePlan & { error?: string };
    if (!response.ok) return { ok: false, error: payload.error ?? `aggregator responded ${response.status}`, plan: null };
    return { ok: true, plan: payload };
  } catch (error) {
    return { ok: false, error: (error as Error).message, plan: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rewrites a design's lyrics with a different writing style.
 *
 * Needed because changing the declared writing style without changing the words would leave a song
 * whose params claim something its lyrics do not do. This is the aggregator's own reroll endpoint, so
 * the retry reuses the loop's lyric writer rather than inventing a second one.
 */
export async function rerollConceptLyrics(
  conceptId: string,
  agent: string,
  seed?: number,
): Promise<{ ok: boolean; error?: string; lyrics: string | null; style: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.aggregator.timeoutMs);
  try {
    const response = await fetch(`${config.aggregator.url}/api/concepts/${encodeURIComponent(conceptId)}/reroll-lyrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, seed }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as {
      error?: string;
      concept?: { lyrics?: string };
      style?: { id?: string };
    };
    if (!response.ok) return { ok: false, error: payload.error ?? `aggregator responded ${response.status}`, lyrics: null, style: null };
    return { ok: true, lyrics: payload.concept?.lyrics ?? null, style: payload.style?.id ?? agent };
  } catch (error) {
    return { ok: false, error: (error as Error).message, lyrics: null, style: null };
  } finally {
    clearTimeout(timer);
  }
}

