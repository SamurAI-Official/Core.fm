/**
 * Turning a song into a verdict the loop can use.
 *
 * Every path that reports one - the verdict route, the older like route, a backfill of verdicts that
 * predate the reporting - comes through here, so the same song cannot be attributed one way by one caller
 * and another way by the next. That divergence is invisible from the app: it shows up as an empty training
 * corpus and a listener profile that quietly never learned.
 */
import { reportPreference, type PreferenceOutcome } from './aggregator.js';

/** The stored generation request, or an empty object. */
export function parseParams(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface VerdictReport {
  /** The response being judged. */
  songId: string;
  /** The app's user id. Prefixed to form the rater, so a backfill and a later click are the same person. */
  userId: string;
  verdict: 'like' | 'dislike' | 'none';
  reasons: string[];
  params: Record<string, unknown>;
  promptId: string | null;
  /** What produced the verdict: `app` for a click, `app-backfill` for one replayed from the app's records. */
  source?: string;
}

/**
 * Reports one verdict to the signal aggregator, with the provenance the ledger needs to make it usable.
 *
 * `market` is optional and often absent: a song made straight from the Create tab answers no brief, so its
 * verdict cannot move market weights. It still teaches the *listener's own* profile, which is the layer that
 * does not need a market.
 *
 * Reported, never thrown: the verdict is already the listener's, and a local app must not refuse a
 * thumbs-down because a second service is not running.
 */
export async function forwardVerdict(input: VerdictReport): Promise<PreferenceOutcome> {
  const { params } = input;
  const themes = Array.isArray(params.lyricThemes)
    ? params.lyricThemes.filter((theme): theme is string => typeof theme === 'string')
    : undefined;
  return reportPreference({
    market: typeof params.market === 'string' && params.market ? params.market : '',
    verdict: input.verdict,
    rater: `app:${input.userId}`,
    // The song id identifies the response; `promptId` identifies the prompt it answered. Retraction needs
    // the response, because that is what the verdict is about.
    sourceId: input.songId,
    reasons: input.reasons,
    source: input.source ?? 'app',
    // `learn` is left to the aggregator: a verdict always teaches the *listener's own* profile (there is
    // nothing to wait for - it is their taste), while reaching a market's weights needs a market and
    // agreement. A Create-tab song has no market, so its verdict stops at the profile.
    //
    // `edition` and `promptId` are the soft-tuning loop's provenance: a verdict is trainable evidence for
    // the edition that produced the response, and a held-out set has to be split by prompt.
    edition: typeof params.edition === 'number' || typeof params.edition === 'string' ? String(params.edition) : undefined,
    promptId: input.promptId ?? undefined,
    // A render made for a listening test is evidence about two editions, not material to train on: the
    // harness tags those jobs, and the tag travels with the verdict so the corpus can exclude it.
    role: params.renderRole === 'evaluation' ? 'evaluation' : undefined,
    features: {
      genre: typeof params.primaryGenre === 'string' ? params.primaryGenre : undefined,
      bpm: typeof params.bpm === 'number' ? params.bpm : undefined,
      keyScale: typeof params.keyScale === 'string' ? params.keyScale : undefined,
      style: typeof params.style === 'string' ? params.style : undefined,
      agent: typeof params.lyricAgent === 'string' ? params.lyricAgent : undefined,
      subject: typeof params.lyricSubject === 'string' ? params.lyricSubject : undefined,
      language:
        typeof params.lyricLanguage === 'string'
          ? params.lyricLanguage
          : typeof params.vocalLanguage === 'string'
            ? params.vocalLanguage
            : undefined,
      themes,
    },
  });
}
