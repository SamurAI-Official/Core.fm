/**
 * HTTP API + dashboard for the signal aggregator.
 *
 * Read endpoints expose trend/brief/design/run data; action endpoints drive the
 * loop by hand (collect, design, cycle, rate). Ratings are the market test step
 * that feeds learning.
 */
import express, { type Request, type Response } from 'express';
import path from 'path';
import { config } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { round } from '../lib/util.js';
import { marketInfo } from '../markets.js';
import { briefConfidence, latestBrief } from '../briefs/build.js';
import { collectSignals } from '../sources/collect.js';
import { availableLanguages, pendingLanguages } from '../design/lyrics/index.js';
import { DEFAULT_AGENT, listAgents } from '../design/agents/registry.js';
import { lyricProvenance } from '../design/provenance.js';
import { flavorFor } from '../design/marketFlavor.js';
import { GENRE_STYLE } from '../design/genreStyle.js';
import { validateLyricPlan, writeLyrics } from '../design/lyrics.js';
import {
  getConcept,
  listConcepts,
  updateConceptFields,
  updateConceptLyrics,
  type ConceptPatch,
} from '../design/store.js';
import { designConcepts } from '../design/designer.js';
import { getRun, listRuns, type RunRecord } from '../loops/store.js';
import { getWeights, unratedRuns, weightNotes } from '../loops/ratings.js';
import { rateRun } from '../loops/rate.js';
import {
  feedbackSummary,
  findRaterVerdict,
  insertFeedback,
  insertVotes,
  listFeedback,
  markWithdrawn,
  verdictRateLimit,
} from '../loops/feedback.js';
import { pendingPromotions, promoteFeedback, promoteRaterVotes, withdrawFeedback } from '../loops/promotion.js';
import { decayStatus, decayWeights, describeDecay } from '../loops/decay.js';
import { applyUserSteps, reverseUserSteps, userProfile } from '../loops/userProfile.js';
import { currentEdition, currentOrdinal, describeEdition, getEdition, listEditions, noWinTrials, adoptEdition, createCandidate, rejectEdition } from '../loops/editions.js';
import { decisionRecord, describeDecision, judgeCandidate } from '../loops/editionGate.js';
import { describeEvidence, evaluationEvidence, evaluationPlan, listenerScorer, BASE_EDITION_ID } from '../loops/editionEvaluation.js';
import { buildCorpus, describeCorpus, writeCorpus } from '../design/editionCorpus.js';
import { nextTake } from '../design/nextTake.js';
import { planFeedback } from '../scoring/feedback.js';
import { runCycle } from '../loops/cycle.js';
import { executeConcept } from '../pipeline/run.js';
import { marketOverview, renderOverviewText } from '../report/overview.js';
import { renderMarketText } from '../report/detail.js';
import { renderForecastOverview, renderForecastText } from '../report/forecast.js';
import { forecastMarket, forecastMarkets } from '../forecast/forecast.js';
import { runScheduledPassNow, schedulerStatus } from '../schedule/scheduler.js';
import { pipeline } from '../pipeline/client.js';
import { dashboardHtml } from './dashboard.js';

/**
 * The endpoints an agent may use, described as data so `GET /api/agent` can hand them over.
 *
 * Kept beside the routes rather than inside the handler so that adding a route and forgetting to describe it
 * is a visible omission in review. The `write` flag is the important one: exactly one entry has it, and that
 * is the invariant worth being able to see at a glance.
 */
const AGENT_ENDPOINTS = [
  {
    method: 'POST',
    path: '/api/feedback',
    write: true,
    purpose: 'record one judgement about one response, and learn from it',
    body: {
      rater: 'required - your rater id, e.g. agent:shugocore',
      verdict: "required - 'like' | 'dislike' | 'none' ('none' retracts your previous verdict on that response)",
      sourceId: 'required - the response you judged (a song id, or a run id you rendered)',
      market:
        'optional - the market it was designed for; without one the verdict reaches your own profile only',
      reasons:
        "optional - what is blamed: 'mix', 'vocals', 'lyrics', 'tempo', 'key', 'genre', 'off-prompt', 'repetition', 'language', 'not-my-kind'",
      features: 'optional - genre, bpm, keyScale, style, agent, subject, language, themes',
      learn: 'optional - false records the verdict without learning from it',
      role: "optional - 'evaluation' marks a render made to compare two editions, which is excluded from training",
      edition: 'optional - the edition that produced the response',
      promptId: 'optional - the prompt it answered, which is how the corpus holds out whole prompts',
      score: 'optional - 0..1, when the judgement is a grade rather than a verdict',
    },
    answers: {
      recorded: 'the verdict is in the ledger',
      replayed: 'you already gave this verdict on this response; nothing was written and nothing moved',
      replaced: 'a different verdict of yours was withdrawn, with its votes released or reversed',
      trusted: 'whether your verdicts may move market weights without agreement',
      applied: 'market keys moved because enough distinct raters agree',
      appliedByTrust: 'market keys moved because *you* are trusted (only when you are)',
      profile: 'keys moved in your own profile, immediately',
      pending: 'keys waiting for agreement, with how many raters are with you so far',
      rateLimited: 'over your daily cap: recorded, but not learned from yet',
      withdrawn: 'what a retraction released, reversed or undid',
    },
  },
  { method: 'GET', path: '/api/feedback?market=&verdict=&limit=', purpose: 'the ledger: recent verdicts, the summary, and what is pending' },
  { method: 'GET', path: '/api/users/:rater/profile', purpose: 'your own learned taste, with the verdict count behind it' },
  { method: 'POST', path: '/api/next-take', purpose: 'what to change when a response was refused, given your reasons' },
  { method: 'GET', path: '/api/editions/corpus', purpose: 'the training corpus and its guards, including what blocks a training run' },
  { method: 'GET', path: '/api/editions/:id/evaluation-plan', purpose: 'the prompts to render under two editions to judge a candidate' },
  { method: 'POST', path: '/api/editions/:id/evaluate', purpose: 'judge a candidate from listening evidence: adopt, reject, or halt' },
  { method: 'POST', path: '/api/editions/candidates', purpose: 'register a candidate you trained' },
  { method: 'GET', path: '/api/editions', purpose: 'the editions, which one is in force, and the stop-rule count' },
  { method: 'GET', path: '/api/agent/state', purpose: 'one read for everything above, so one round trip is enough to orient' },
];


export function createApp(): express.Express {
  runMigrations();

  // Weights are a summary of what recent listeners wanted, so a service that has been switched off for
  // a month must not come back holding the opinions it had then. One pass at startup costs a few
  // hundred comparisons and makes every weight in the dashboard current.
  const startupDecay = decayWeights();
  if (startupDecay.scopes.some((scope) => scope.moved > 0)) {
    for (const line of describeDecay(startupDecay)) console.log(`[decay] ${line}`);
  }

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // CORS: the aggregator is called from the ace-step-ui frontend (usually through
  // the Vite proxy, but direct/LAN access is allowed too, mirroring the UI's policy).
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();
    const allowed =
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
      /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(origin);
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Rendered audio, for local listening in the dashboard.
  const audioRoot = path.join(path.dirname(config.dbPath), 'audio');
  app.use('/audio', express.static(audioRoot));

  app.get('/', (_req: Request, res: Response) => {
    res.type('html').send(dashboardHtml());
  });

  app.get('/api/health', async (_req: Request, res: Response) => {
    const health = await pipeline.health();
    res.json({
      ok: true,
      markets: config.markets,
      db: config.dbPath,
      pipeline: { url: pipeline.baseUrl, healthy: health.ok, detail: health.detail },
    });
  });

  app.get('/api/overview', (_req: Request, res: Response) => {
    res.json({ markets: marketOverview() });
  });

  app.get('/api/report/overview', (_req: Request, res: Response) => {
    res.type('text/plain').send(renderOverviewText());
  });

  app.get('/api/report/market/:cc', (req: Request, res: Response) => {
    res.type('text/plain').send(renderMarketText(String(req.params.cc).toLowerCase()));
  });

  app.get('/api/markets/:cc', (req: Request, res: Response) => {
    const market = String(req.params.cc).toLowerCase();
    const brief = latestBrief(market);
    res.json({
      market,
      info: marketInfo(market),
      brief,
      confidence: brief ? briefConfidence(brief) : 0,
      forecast: forecastMarket(market, { horizonDays: config.forecast.horizonDays }),
      concepts: listConcepts({ market, limit: 25 }),
      runs: listRuns({ market, limit: 25 }),
      weights: getWeights(market),
      ratingQueue: unratedRuns(market, 25),
    });
  });

  // Forward-looking view. `text` mirrors the CLI output so the UI can show the
  // caveat verbatim rather than re-deriving (and possibly softening) it.
  app.get('/api/forecast', (req: Request, res: Response) => {
    const market = req.query.market ? String(req.query.market).toLowerCase() : undefined;
    const horizonDays = req.query.horizon ? Number(req.query.horizon) : config.forecast.horizonDays;
    const forecasts = forecastMarkets(market ? [market] : config.markets, { horizonDays });
    res.json({
      horizonDays,
      forecasts,
      text: market ? renderForecastText(forecasts[0]) : renderForecastOverview(forecasts),
    });
  });

  app.get('/api/forecast/:cc', (req: Request, res: Response) => {
    const market = String(req.params.cc).toLowerCase();
    const horizonDays = req.query.horizon ? Number(req.query.horizon) : config.forecast.horizonDays;
    const forecast = forecastMarket(market, { horizonDays });
    res.json({ forecast, text: renderForecastText(forecast) });
  });

  // Collection scheduler state, so the UI can show whether history is actually
  // accumulating (a forecast with no scheduler behind it never becomes usable).
  app.get('/api/schedule', (_req: Request, res: Response) => {
    res.json({
      schedule: schedulerStatus(),
      enabledInConfig: config.schedule.enabled,
      intervalMinutes: config.schedule.intervalMinutes,
      markets: config.markets,
    });
  });

  app.post('/api/schedule/run', async (_req: Request, res: Response) => {
    try {
      const status = await runScheduledPassNow();
      res.json({ schedule: status });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/runs', (req: Request, res: Response) => {
    res.json({
      runs: listRuns({
        market: req.query.market ? String(req.query.market).toLowerCase() : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      }).map(serializeRun),
    });
  });

  app.get('/api/rating-queue', (req: Request, res: Response) => {
    res.json({
      runs: unratedRuns(
        req.query.market ? String(req.query.market).toLowerCase() : undefined,
        req.query.limit ? Number(req.query.limit) : 50,
      ).map(serializeRun),
    });
  });

  app.post('/api/ratings', (req: Request, res: Response) => {
    try {
      const { runId, score, verdict, reasons, notes, rater } = req.body as {
        runId?: unknown;
        score?: unknown;
        verdict?: unknown;
        reasons?: unknown;
        notes?: string;
        rater?: string;
      };
      if (typeof runId !== 'string' || !runId || typeof score !== 'number') {
        res.status(400).json({ error: 'runId (string) and score (number) are required' });
        return;
      }
      res.json(
        rateRun({
          runId,
          score,
          verdict: verdict === 'dislike' || verdict === 'like' ? verdict : undefined,
          reasons: Array.isArray(reasons)
            ? reasons.filter((reason): reason is string => typeof reason === 'string')
            : undefined,
          notes,
          rater,
        }),
      );
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  /**
   * Preference on any output, not only on a designed run.
   *
   * This is the dislike button's endpoint. A song generated straight from the Create tab has no run
   * to rate, so the caller sends features instead of an id: the market, and whatever provenance the
   * output carries (genre, tempo, key, the style prompt, writing style, subject, language, themes).
   * A verdict is recorded immediately but does not move a market's weights on its own: it becomes one
   * or more *votes*, and `promoteFeedback` applies them once `FEEDBACK_MIN_USERS` distinct raters
   * agree. The response says which of the two happened - `applied` for what moved now, `pending` for
   * what is still waiting on other listeners - so a caller can be honest about the effect.
   *
   * `verdict: 'none'` retracts: it finds the caller's most recent verdict on the same response and
   * takes it out of the count, undoing any weight it had already moved.
   */
  app.post('/api/feedback', (req: Request, res: Response) => {
    try {
      const { market, verdict, score, reasons, features, source, learn, rater, sourceId, edition, promptId, role } =
        req.body as {
          market?: unknown;
          verdict?: unknown;
          score?: unknown;
          reasons?: unknown;
          features?: unknown;
          source?: unknown;
          learn?: unknown;
          rater?: unknown;
          sourceId?: unknown;
          edition?: unknown;
          promptId?: unknown;
          role?: unknown;
        };
      if (verdict !== 'like' && verdict !== 'dislike' && verdict !== 'none') {
        res.status(400).json({ error: "verdict must be 'like', 'dislike' or 'none'" });
        return;
      }
      const marketCode = typeof market === 'string' && market ? market.toLowerCase() : undefined;
      const raterId = typeof rater === 'string' && rater ? rater : undefined;
      const sourceKey = typeof sourceId === 'string' && sourceId ? sourceId : undefined;
      const reasonList = Array.isArray(reasons)
        ? reasons.filter((reason): reason is string => typeof reason === 'string')
        : [];
      const bag = features && typeof features === 'object' ? (features as Record<string, unknown>) : {};
      const cleanFeatures = {
        genre: typeof bag.genre === 'string' ? bag.genre : undefined,
        bpm: typeof bag.bpm === 'number' ? bag.bpm : undefined,
        keyScale: typeof bag.keyScale === 'string' ? bag.keyScale : undefined,
        style: typeof bag.style === 'string' ? bag.style : undefined,
        agent: typeof bag.agent === 'string' ? bag.agent : undefined,
        subject: typeof bag.subject === 'string' ? bag.subject : undefined,
        language: typeof bag.language === 'string' ? bag.language : undefined,
        themes: Array.isArray(bag.themes)
          ? bag.themes.filter((theme): theme is string => typeof theme === 'string')
          : undefined,
      };

      // Retraction: the same person taking back the same judgement.
      if (verdict === 'none') {
        if (!raterId || !sourceKey) {
          res.json({
            verdict,
            market: marketCode ?? null,
            withdrawn: null,
            note: 'nothing to retract: rater and sourceId are both needed to find the verdict',
          });
          return;
        }
        // Found without a market, because a verdict on a song nobody designed a market for still has to be
        // takeable back. The market is read off the row that is being retracted, not off the request.
        const prior = findRaterVerdict({ rater: raterId, sourceId: sourceKey });
        if (!prior) {
          res.json({
            verdict,
            market: marketCode ?? null,
            withdrawn: null,
            note: 'no verdict of yours to retract on this response',
          });
          return;
        }
        const result = prior.market
          ? withdrawFeedback({ market: prior.market, feedbackId: prior.id })
          : { found: false, released: 0, reversed: [] };
        const profileUndone = reverseUserSteps(raterId, prior.plan);
        markWithdrawn(prior.id);
        res.json({
          verdict,
          market: prior.market,
          withdrawn: {
            id: prior.id,
            was: prior.verdict,
            released: result.released,
            reversed: result.reversed,
            profile: profileUndone,
          },
          notes: prior.market ? weightNotes(prior.market) : [],
        });
        return;
      }

      /**
       * One verdict per (rater, response). A replayed report is not a second opinion, and an agent that
       * retries a POST is the likely caller - counting it twice would double its votes toward agreement
       * and double the step in its own profile. So:
       *
       *   - same verdict again: answered as a replay, nothing written, nothing moved;
       *   - a different verdict: the old one is withdrawn (votes released or reversed, profile undone) and
       *     the new one takes its place, which is what changing your mind has to mean if retraction and
       *     re-judging are to compose.
       */
      const existing = raterId && sourceKey ? findRaterVerdict({ rater: raterId, sourceId: sourceKey }) : null;
      if (existing && existing.verdict === verdict) {
        res.json({
          id: existing.id,
          verdict,
          market: existing.market,
          rater: raterId ?? null,
          recorded: true,
          replayed: true,
          votes: 0,
          applied: [],
          pending: [],
          profile: [],
          note: 'already recorded by this rater on this response; nothing changed',
        });
        return;
      }
      let replaced: { id: string; was: string; released: number; reversed: string[]; profile: string[] } | null = null;
      if (existing) {
        const undone = existing.market
          ? withdrawFeedback({ market: existing.market, feedbackId: existing.id })
          : { found: false, released: 0, reversed: [] };
        replaced = {
          id: existing.id,
          was: existing.verdict,
          released: undone.released,
          reversed: undone.reversed,
          profile: reverseUserSteps(raterId as string, existing.plan),
        };
        markWithdrawn(existing.id);
      }

      // The cap is checked *before* this verdict is recorded, so the Nth verdict is the last one that
      // acts: counting after the insert would let one extra through every window.
      const rateLimit = raterId ? verdictRateLimit(raterId) : null;
      const rateLimited = Boolean(rateLimit && !rateLimit.allowed);

      /**
       * Over the cap *and* changing an earlier verdict: refuse, and leave the earlier one standing.
       *
       * The alternative - withdrawing the old verdict and recording a new one that acts on nothing - would
       * take away a preference the listener had already expressed and replace it with a judgement that
       * teaches nothing, which is the worst of both. One standing verdict per (rater, response) is what the
       * corpus, the judge and retraction all rely on, so the pair is left as it was.
       */
      if (existing && rateLimited) {
        res.json({
          id: existing.id,
          verdict: existing.verdict,
          market: existing.market,
          rater: raterId ?? null,
          recorded: true,
          replayed: false,
          replaced: null,
          votes: 0,
          applied: [],
          pending: [],
          profile: [],
          rateLimited,
          rateLimit,
          note:
            `you are over the cap of ${rateLimit?.limit ?? 0} verdicts per ` +
            `${rateLimit?.windowHours ?? 24}h, so the verdict you already gave on this response stands; ` +
            'retract it if you want to withdraw it',
        });
        return;
      }

      // Planned whenever the caller has not opted out *and* the caller is not over its cap. Note the
      // scope split: a *market* needs a market (below), but the caller's own profile does not - which is
      // what lets a hard no on a Create-tab song teach *their* taste even though there is no market for
      // it to reach.
      const plan =
        learn === false || rateLimited
          ? { steps: [], notes: [] }
          : planFeedback({
              market: marketCode,
              verdict,
              score: typeof score === 'number' ? score : undefined,
              reasons: reasonList,
              features: cleanFeatures,
            });

      const id = insertFeedback({
        market: marketCode,
        verdict,
        score: typeof score === 'number' ? score : undefined,
        reasons: reasonList,
        features: cleanFeatures,
        source: typeof source === 'string' ? source : 'api',
        rater: raterId,
        sourceId: sourceKey,
        edition: edition === undefined || edition === null ? undefined : String(edition),
        promptId: typeof promptId === 'string' && promptId ? promptId : undefined,
        // Only 'evaluation' is honoured; anything else is training material, so a typo cannot silently
        // turn a listening-test verdict into (or away from) learning.
        role: role === 'evaluation' ? 'evaluation' : 'training',
        // Recorded with the row so a later retraction can undo the listener's own profile, not just the
        // market's votes.
        plan: plan.steps,
      });

      const votes =
        marketCode && plan.steps.length > 0
          ? insertVotes({
              feedbackId: id,
              market: marketCode,
              sign: verdict === 'dislike' ? -1 : 1,
              rater: raterId,
              steps: plan.steps,
            })
          : 0;

      // Layer U: the listener's own profile moves at once, with no threshold and no window. The gate
      // below decides what a *market* hears; this decides what this person hears next, and there is
      // nothing to wait for - it is their own hard no. `learn: false` still means "record only".
      const profileApplied =
        raterId && learn !== false ? applyUserSteps(raterId, plan.steps) : [];

      /**
       * A trusted rater's own votes move the market now, without waiting for `minUsers` distinct raters.
       *
       * Off unless the caller's rater id is named in `FEEDBACK_TRUSTED_RATERS`, which is the whole point:
       * an agent's taste reaches the market only when somebody deliberately says so, and the same agent is
       * an ordinary listener the moment the flag is removed. Everything else still applies - the cap has
       * already decided whether there was a plan to vote on, `FEEDBACK_PROMOTE=false` still writes nothing,
       * and a replay statement writes nothing at all (it returns above).
       */
      const trusted = Boolean(raterId && config.feedback.trustedRaters.includes(raterId as string));
      const byTrust =
        trusted && marketCode && votes > 0 && learn !== false
          ? promoteRaterVotes({ market: marketCode, rater: raterId as string })
          : [];

      // Only this market is reconsidered, and only after a vote exists: a promotion is a consequence of
      // what is in the ledger, never of the request alone.
      const promoted = marketCode && votes > 0 ? promoteFeedback({ market: marketCode }) : [];
      const mine = promoted.filter((event) => plan.steps.some((step) => step.key === event.key));
      const pending = marketCode
        ? pendingPromotions(marketCode)
            .filter((event) => plan.steps.some((step) => step.key === event.key))
            .map((event) => ({
              key: event.key,
              sign: event.sign,
              raters: event.raters,
              needed: Math.max(1, config.feedback.minUsers),
              delta: event.delta,
            }))
        : [];

      res.json({
        id,
        verdict,
        market: marketCode ?? null,
        rater: raterId ?? null,
        recorded: true,
        votes,
        /** Weight moves this verdict caused now, because enough distinct listeners agree. */
        applied: mine
          .filter((event) => event.applied)
          .map((event) => `${event.key} -> ${round(event.after ?? event.before, 3)}`),
        /**
         * Weight moves caused by this rater being *trusted* rather than by agreement: the keys its own
         * votes moved without a second rater. Reported separately so "why did this market move on one
         * verdict?" is answerable from the response as well as from the ledger.
         */
        appliedByTrust: byTrust.map((event) => `${event.key} -> ${round(event.after ?? event.before, 3)}`),
        /** True when this rater is named in `FEEDBACK_TRUSTED_RATERS`. */
        trusted,
        /** Keys still short of agreement, with how many listeners are with the caller so far. */
        pending,
        /** What moved in the *caller's own* profile, immediately, on the strength of their verdict. */
        profile: profileApplied,
        /**
         * True when this verdict was recorded but not acted on, because the caller is over its cap. Says
         * so in the payload rather than only in a log: a verdict that quietly stops teaching is exactly
         * the kind of silence this loop is built to avoid.
         */
        rateLimited,
        rateLimit,
        /**
         * Set when this verdict replaced an earlier, different one from the same rater: the old row is
         * withdrawn, its votes released or reversed, and its profile steps undone. Reported rather than done
         * silently, because "my dislike became a like" has to be visible in the ledger's answer.
         */
        replaced,
        notes: marketCode ? weightNotes(marketCode) : [],
        learner: {
          minUsers: Math.max(1, config.feedback.minUsers),
          windowDays: Math.max(1, Math.round(config.feedback.windowDays)),
          promoting: config.feedback.promote,
        },
        planNotes: plan.notes,
      });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  /**
   * A listener's own profile: what this person wants more and less of.
   *
   * Deliberately separate from the market's weights, and reported with the number of verdicts behind
   * it, because a profile built from one click should not be treated like one built from fifty. The
   * caller decides what to do with that - the app uses it for defaults and for the retry decision,
   * and only once there is enough of it to mean something.
   */
  app.get('/api/users/:rater/profile', (req: Request, res: Response) => {
    try {
      const rater = decodeURIComponent(req.params.rater);
      const profile = userProfile(rater);
      const market = req.query.market ? String(req.query.market).toLowerCase() : undefined;
      res.json({
        ...profile,
        /**
         * How much of today's cap this listener has used. Reported with the profile because it is the
         * same question from the other side: how much of what this person has said is being acted on.
         */
        rateLimit: verdictRateLimit(rater),
        /** The market's own weights for the same keys, when asked for, so a caller can compare the two. */
        market: market ? getWeights(market) : null,
      });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  /**
   * The next take: what to change when a listener rejects a response to their own prompt.
   *
   * The app owns the prompt and the render; this owns the vocabularies (genres, tags, writing styles)
   * and the listener's profile, so the decision is made where those live rather than re-implemented
   * from a copy. The route only validates and forwards - `nextTake` holds the rules.
   */
  app.post('/api/next-take', (req: Request, res: Response) => {
    try {
      const { rater, reasons, previous, excludeSeeds, attempt } = req.body as {
        rater?: unknown;
        reasons?: unknown;
        previous?: unknown;
        excludeSeeds?: unknown;
        attempt?: unknown;
      };
      if (typeof rater !== 'string' || !rater) {
        res.status(400).json({ error: 'rater (string) is required' });
        return;
      }
      if (!previous || typeof previous !== 'object') {
        res.status(400).json({ error: 'previous (the params of the take being retried) is required' });
        return;
      }
      res.json(
        nextTake({
          rater,
          reasons: Array.isArray(reasons)
            ? reasons.filter((reason): reason is string => typeof reason === 'string')
            : [],
          previous: previous as Parameters<typeof nextTake>[0]['previous'],
          excludeSeeds: Array.isArray(excludeSeeds)
            ? excludeSeeds.map((seed) => Number(seed)).filter((seed) => Number.isFinite(seed))
            : [],
          attempt: typeof attempt === 'number' ? attempt : undefined,
        }),
      );
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  /**
   * Decay: run a pass now, or ask what it would do.
   *
   * Exposed because decay is otherwise invisible housekeeping - it runs at startup, on every scheduled
   * pass, and at the head of a cycle - and "the weights went back to neutral and I do not know why" is a
   * question that deserves an answer rather than an explanation of the maths.
   */
  app.post('/api/decay', (req: Request, res: Response) => {
    try {
      const dryRun = (req.body as { dryRun?: unknown })?.dryRun === true;
      const report = decayWeights({ dryRun });
      res.json({ ...report, notes: describeDecay(report), status: decayStatus() });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  /** When the weights were last decayed, and how strong the rule is. */
  app.get('/api/decay', (_req: Request, res: Response) => {
    res.json(decayStatus());
  });

  /**
   * The editions registry and the corpus for the next one.
   *
   * Read-only plus one explicit action: building a corpus writes a file and changes nothing about what
   * listeners hear. Adoption is deliberately *not* exposed here yet - it belongs with the executor that
   * can produce the evidence for it (preprocess, train, render, score), because an adoption endpoint that
   * anything could call is an adoption that happens without a measurement.
   */
  app.get('/api/editions', (_req: Request, res: Response) => {
    const editions = listEditions();
    const current = currentEdition();
    res.json({
      current: current ? { id: current.id, ordinal: current.ordinal, adoptedAt: current.adoptedAt } : null,
      /** 0 when the base model is in force, which is a state and not an error. */
      currentOrdinal: currentOrdinal(),
      noWinTrials: noWinTrials(),
      maxNoWinTrials: config.edition.maxNoWinTrials,
      editions: editions.map((edition) => ({ ...edition, summary: describeEdition(edition) })),
    });
  });

  /** What the next edition would train on, and whether it is allowed to. */
  app.get('/api/editions/corpus', (req: Request, res: Response) => {
    const dryRunOnly = req.query.write !== 'true';
    const corpus = buildCorpus();
    const written = dryRunOnly ? null : writeCorpus(corpus);
    res.json({
      manifest: corpus.manifest,
      notes: describeCorpus(corpus),
      train: corpus.train.map((sample) => ({ id: sample.id, verdict: sample.verdict, reasons: sample.reasons, edition: sample.edition })),
      heldOut: corpus.heldOut.map((pair) => ({ promptKey: pair.promptKey, market: pair.market, liked: pair.liked.length, disliked: pair.disliked.length })),
      anchors: corpus.anchors.map((anchor) => ({ id: anchor.id, market: anchor.market, chartDerived: anchor.chartDerived })),
      written,
    });
  });

  /**
   * The agent contract: what an autonomous caller may do, and what it will get back.
   *
   * Written as data rather than prose so an agent can discover the surface without reading this file, and
   * deliberately explicit about the two things that are easy to get wrong from outside:
   *
   *   - **there is one write path**, `POST /api/feedback`. It is the same one a listener's click uses, so an
   *     agent's judgement and a person's cannot mean different things - or move different weights.
   *   - **an agent is a rater, not a privileged caller.** Its verdicts teach its *own* profile at once, and
   *     they move a market's weights only if it is named in `FEEDBACK_TRUSTED_RATERS`. This endpoint reports
   *     which of the two applies, instead of leaving it to be discovered.
   */
  app.get('/api/agent', (req: Request, res: Response) => {
    const rater = req.query.rater ? String(req.query.rater) : null;
    const isTrusted = Boolean(rater && config.feedback.trustedRaters.includes(rater));
    res.json({
      contract: 'signal-aggregator/agent/v1',
      /**
       * What this service is, in one line, because an agent that cannot see the dashboard needs a model of
       * what it is talking to: chart signals in, song designs out, listener judgement learned from.
       */
      purpose:
        'Turns chart signals into song designs, and learns from judgements about what those designs produced.',
      /** Trust is the only thing that differs between an agent and a person here. */
      trust: {
        rater,
        trusted: isTrusted,
        trustedRaters: config.feedback.trustedRaters,
        effect: isTrusted
          ? "this rater's own verdicts move the named market's weights immediately, without waiting for " +
            'other raters to agree'
          : "this rater's verdicts teach its own profile immediately, and are held as pending votes until " +
            'FEEDBACK_MIN_USERS distinct raters agree',
        /** How to change it: a flag, not an identity, so removing the name restores the ordinary gate. */
        change: 'set FEEDBACK_TRUSTED_RATERS (comma-separated) and restart the service',
      },
      endpoints: AGENT_ENDPOINTS,
      /** What an agent must not do, stated because silence here invites a guess. */
      cannot: [
        'adopt an edition by preference alone - a candidate is adopted only if held-out preferences plus the quality gates pass',
        'move a market without being trusted, or with FEEDBACK_PROMOTE=false set',
        'avoid the daily cap, which counts verdicts sent: retracting one does not buy another',
        'train on evaluation renders: verdicts tagged role=evaluation are excluded from every corpus',
      ],
      config: {
        minUsersForAgreement: Math.max(1, config.feedback.minUsers),
        windowDays: Math.max(1, Math.round(config.feedback.windowDays)),
        promote: config.feedback.promote,
        maxVerdictsPerDay: config.feedback.maxVerdictsPerDay,
        decayPerWeek: config.scoring.decayPerWeek,
      },
    });
  });

  /**
   * One read that orients an agent: what is in force, what it has learned from, and what it could do next.
   *
   * The point is a single round trip at the start of a session, so an autonomous caller does not have to
   * reconstruct the loop's state from six endpoints - and cannot accidentally act on a stale picture.
   */
  app.get('/api/agent/state', (req: Request, res: Response) => {
    const rater = req.query.rater ? String(req.query.rater) : null;
    const market = req.query.market ? String(req.query.market).toLowerCase() : null;
    const corpus = buildCorpus();
    const trials = noWinTrials();
    const inForce = currentEdition();
    res.json({
      contract: 'signal-aggregator/agent/v1',
      now: new Date().toISOString().replace('T', ' ').slice(0, 19),
      market,
      edition: {
        // The base model is a state, not an error: with nothing adopted yet, say so rather than describing a
        // record that does not exist (describeEdition expects a row and throws on null).
        inForce: inForce ? describeEdition(inForce) : 'the base model (no edition adopted yet)',
        ordinal: currentOrdinal(),
        // The stop rule, reported because it is the one state an agent cannot infer from a failure.
        noWinTrials: trials,
        maxNoWinTrials: config.edition.maxNoWinTrials,
      },
      corpus: {
        hash: corpus.hash,
        counts: corpus.manifest.counts,
        blockers: corpus.manifest.blockers,
        trainable: corpus.manifest.blockers.length === 0,
      },
      weights: market ? { market, notes: weightNotes(market) } : { market: null, notes: [] },
      rater: rater
        ? {
            id: rater,
            trusted: config.feedback.trustedRaters.includes(rater),
            profile: userProfile(rater),
            rateLimit: verdictRateLimit(rater),
          }
        : null,
      /** What an agent would plausibly do next, derived from the state above rather than from a script. */
      next: [
        ...(corpus.manifest.blockers.length > 0
          ? [
              `the corpus is blocked: ${corpus.manifest.blockers.join('; ')} - judgements on new designs, ` +
                'not code changes, are what clear this',
            ]
          : ['the corpus is trainable: a candidate can be trained and then judged on the held-out prompts']),
        ...(trials >= config.edition.maxNoWinTrials
          ? ['the tuning loop has halted after repeated failures to win: a human decides what happens next']
          : []),
        'record judgements with POST /api/feedback (one verdict per response; a repeat is answered, not counted twice)',
        market
          ? `GET /api/reports/${market} to see the evidence behind this market`
          : 'name a market (?market=gb) to see its weights and its reports',
      ],
    });
  });

  /**
   * Register a candidate edition prepared by the executor.
   *
   * The executor owns the training run (dataset, preprocess, train, export) because that needs the engine
   * and the audio; this owns the record. A candidate is registered *before* it is judged, so a training run
   * can be inspected - and thrown away - without ever being in force.
   */
  app.post('/api/editions/candidates', (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        datasetHash?: unknown;
        datasetManifest?: unknown;
        datasetPath?: unknown;
        hyperparameters?: unknown;
        adapterPath?: unknown;
        baseId?: unknown;
        feedbackWindow?: unknown;
        notes?: unknown;
      };
      if (typeof body.datasetHash !== 'string' || !body.datasetHash) {
        res.status(400).json({ error: 'datasetHash is required: a candidate must name the corpus it trained on' });
        return;
      }
      const base = currentEdition();
      const edition = createCandidate({
        baseId: typeof body.baseId === 'string' ? body.baseId : (base?.id ?? null),
        datasetHash: body.datasetHash,
        datasetManifest:
          body.datasetManifest && typeof body.datasetManifest === 'object'
            ? (body.datasetManifest as Record<string, unknown>)
            : {},
        datasetPath: typeof body.datasetPath === 'string' ? body.datasetPath : undefined,
        hyperparameters:
          body.hyperparameters && typeof body.hyperparameters === 'object'
            ? (body.hyperparameters as Record<string, unknown>)
            : {},
        adapterPath: typeof body.adapterPath === 'string' ? body.adapterPath : undefined,
        feedbackWindow:
          body.feedbackWindow && typeof body.feedbackWindow === 'object'
            ? (body.feedbackWindow as Record<string, unknown>)
            : undefined,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
      });
      res.json({
        edition,
        /** The hyperparameters the executor should use if it has not run yet: the engine's own defaults. */
        defaults: { rank: 64, alpha: 128, dropout: 0.1, learningRate: 0.0003, epochs: 1000, batchSize: 1, saveEvery: 200, shift: 3, seed: 42 },
      });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  /**
   * Judge a candidate edition on the evidence from a listening test, and act on the verdict.
   *
   * This is where the loop is allowed to change what listeners hear, so everything it needs is required:
   * the candidate, the incumbent it would replace (or the base model), the quality gates that already
   * exist, and enough decided pairs to tell the two apart. The evidence is *not* supplied by the caller -
   * it is read from verdicts the listener gave, which is the whole point: adoption rests on preference,
   * not on a number the trainer reports.
   *
   * A `halt` is not a failure. It means the loop has produced `EDITION_MAX_NO_WIN_TRIALS` candidates in a
   * row that could not beat what is already in force, and the honest thing is to stop and let a person
   * look at the corpus rather than keep spending GPU time on noise.
   */
  app.post('/api/editions/:id/evaluate', (req: Request, res: Response) => {
    try {
      const candidate = getEdition(String(req.params.id));
      if (!candidate) {
        res.status(404).json({ error: 'edition not found' });
        return;
      }
      if (candidate.status === 'adopted' || candidate.status === 'retired') {
        res.status(409).json({ error: `edition is ${candidate.status}; only a candidate can be judged` });
        return;
      }

      const body = (req.body ?? {}) as { qualityGates?: unknown; dryRun?: unknown };
      const qualityGatesInput = body.qualityGates as { passed?: unknown; failures?: unknown } | undefined;
      const qualityGates = {
        passed: qualityGatesInput?.passed !== false,
        failures: Array.isArray(qualityGatesInput?.failures)
          ? (qualityGatesInput?.failures as unknown[]).map(String)
          : [],
      };

      const evidence = evaluationEvidence();
      const incumbent = currentEdition();
      const incumbentId = incumbent?.id ?? BASE_EDITION_ID;
      /**
       * Only the pairs that compare *these two editions*.
       *
       * The evidence accumulates - every listening test ever run stays in the ledger - and without this
       * filter a new candidate is judged on history: pairs where the incumbent beat some *other* edition
       * read as losses for a candidate that was not involved, so a good candidate can be refused for
       * something it never did. A pair where the candidate is not one of the two sides says nothing about
       * whether to adopt it, so it is set aside (and counted, so the omission is visible).
       */
      const pairs = evidence.pairs.filter(
        (pair) =>
          (pair.likedEdition === candidate.id || pair.dislikedEdition === candidate.id) &&
          (pair.likedEdition === incumbentId || pair.dislikedEdition === incumbentId),
      );
      const setAside = evidence.pairs.length - pairs.length;

      const decision = judgeCandidate({
        candidateId: candidate.id,
        /**
         * The base model is a real comparison target, not a missing incumbent: its renders carry the
         * 'base' pseudo-id, so a listener's preference against them is what decides. Only when nothing was
         * adopted *and* the base model never rendered does this fall back to "no incumbent".
         */
        incumbentId,
        pairs,
        score: listenerScorer(evidence.editions),
        qualityGates,
        noWinTrials: noWinTrials(),
      });
      const record = decisionRecord(decision);

      if (body.dryRun === true) {
        res.json({
          dryRun: true,
          candidate: { id: candidate.id, ordinal: candidate.ordinal },
          incumbentId,
          decision: record,
          notes: describeDecision(decision),
          evidence: describeEvidence(evidence),
          /** Pairs from other comparisons, set aside because they say nothing about this one. */
          setAside,
        });
        return;
      }

      const applied =
        decision.decision === 'adopt'
          ? adoptEdition(candidate.id, record, { notes: `adopted on ${decision.pairs} listened pair(s)` })
          : rejectEdition(candidate.id, record);

      res.json({
        candidate: { id: candidate.id, ordinal: candidate.ordinal, status: applied.status },
        incumbentId,
        decision: record,
        notes: describeDecision(decision),
        evidence: describeEvidence(evidence),
        setAside,
        /** What the next render should carry now: 0 for the base model, otherwise the adopted ordinal. */
        currentOrdinal: currentOrdinal(),
      });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  /**
   * What the harness has to render for a listening test, and what is already waiting to be judged.
   *
   * Phrased as work rather than as data, because the two failure points of a listening test are rendering
   * a prompt under only one edition (which cannot compare anything) and judging only one of the two
   * renders - both of which the plan and the evidence count make visible instead of silently producing an
   * unconvincing evaluation.
   */
  app.get('/api/editions/:id/evaluation-plan', (req: Request, res: Response) => {
    const candidate = getEdition(String(req.params.id));
    if (!candidate) {
      res.status(404).json({ error: 'edition not found' });
      return;
    }
    const incumbent = currentEdition();
    const corpus = buildCorpus();
    res.json(evaluationPlan(candidate.id, incumbent?.id ?? null, corpus.heldOut));
  });

  /**
   * What listeners have said, what they objected to, and what is still waiting for agreement.
   *
   * `pending` is the interesting half of the gate: it shows votes that have been recorded and are one
   * listener short of moving the market, which is what makes a slow learner legible rather than
   * looking like the button does nothing.
   */
  app.get('/api/feedback', (req: Request, res: Response) => {
    const market = req.query.market ? String(req.query.market).toLowerCase() : undefined;
    res.json({
      summary: feedbackSummary(2000, market),
      recent: listFeedback({
        market,
        verdict:
          req.query.verdict === 'like' || req.query.verdict === 'dislike' ? req.query.verdict : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 20,
      }),
      pending: pendingPromotions(market).map((event) => ({
        market: event.market,
        key: event.key,
        sign: event.sign,
        raters: event.raters,
        votes: event.votes,
        needed: Math.max(1, config.feedback.minUsers),
        delta: event.delta,
        before: event.before,
      })),
      learner: {
        minUsers: Math.max(1, config.feedback.minUsers),
        windowDays: Math.max(1, Math.round(config.feedback.windowDays)),
        promoting: config.feedback.promote,
      },
    });
  });

  app.post('/api/collect', async (req: Request, res: Response) => {
    try {
      const marketList = (req.body?.markets as string[] | undefined)?.map((m) => m.toLowerCase());
      const report = await collectSignals({
        markets: marketList ?? config.markets,
        enrichTop: req.body?.enrichTop ?? 20,
        includeGlobal: req.body?.includeGlobal ?? true,
      });
      res.json(report);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/design', (req: Request, res: Response) => {
    try {
      const marketList = ((req.body?.markets as string[] | undefined) ?? config.markets).map((m) =>
        m.toLowerCase(),
      );
      const perMarket = req.body?.perMarket ?? config.design.conceptsPerMarket;
      const concepts = marketList.flatMap((market) => {
        const brief = latestBrief(market);
        if (!brief) return [];
        return designConcepts({
          market,
          brief,
          count: perMarket,
          learnedWeights: getWeights(market),
          seed: req.body?.seed,
          instrumental: req.body?.instrumental,
        });
      });
      res.json({ designed: concepts.length, concepts });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/cycle', async (req: Request, res: Response) => {
    try {
      const report = await runCycle({
        markets: (req.body?.markets as string[] | undefined)?.map((m) => m.toLowerCase()),
        perMarket: req.body?.perMarket,
        generateLimit: req.body?.generateLimit ?? 0,
        reuseSignals: req.body?.reuseSignals === true,
        enrichTop: req.body?.enrichTop ?? 10,
        seed: req.body?.seed,
        instrumental: req.body?.instrumental,
      });
      res.json(report);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- UI integration endpoints ------------------------------------------------

  /**
   * Turns a stored local audio path into a URL this service serves.
   * Paths may be absolute or relative (`data/audio/<market>/<file>`), so the
   * market subfolder is resolved against the audio root rather than string-matched.
   */
  const audioUrlFor = (localPath: string): string => {
    const resolvedRoot = path.resolve(audioRoot);
    const resolvedFile = path.resolve(localPath);
    const relative = path.relative(resolvedRoot, resolvedFile).replace(/\\/g, '/');
    // Guard against a path outside the audio root (defensive, should not happen).
    const safe = relative.startsWith('..') ? path.basename(resolvedFile) : relative;
    return `/audio/${safe}`;
  };

  const serializeRun = (run: RunRecord) => ({
    ...run,
    /** Playable URLs for this service's local copies (proxy them at /aggregator). */
    audioFiles: run.localAudio.map(audioUrlFor),
  });

  app.get('/api/markets', (_req: Request, res: Response) => {
    res.json({
      markets: config.markets.map((market) => ({ market, ...marketInfo(market) })),
    });
  });

  /**
   * Language options for the UI's vocal-language dropdown.
   *
   * Served from the pack registry rather than hard-coded in the client: the list of
   * languages a concept may be set to and the list of languages the writer can actually
   * write are the same thing, and they had already drifted (a `ru` pack existed while
   * `ru` was missing from the dropdown). `languages` are the packs; `pending` are known
   * codes without a pack, which fall back to English and say so.
   */
  app.get('/api/languages', (_req: Request, res: Response) => {
    res.json({
      languages: availableLanguages(),
      pending: pendingLanguages(),
    });
  });

  /**
   * Writing styles, from the agent registry.
   *
   * Same anti-drift reason as languages: the dropdown and the writer must not be able to
   * disagree about which styles exist. `packs` says which languages can really write each
   * style today, so the UI can mark the rest honestly instead of offering them blindly.
   */
  app.get('/api/agents', (_req: Request, res: Response) => {
    res.json({ agents: listAgents(), defaultAgent: DEFAULT_AGENT });
  });

  /**
   * Rewrites one concept's lyrics with a chosen (or freshly drawn) writing style.
   *
   * Design-time only selection would make twenty styles unreachable: this is how a style is
   * tried against a market and a subject without a full design run and without a render.
   * The concept's market, genre, language and tempo are reused, so what changes is how the
   * song is built - and the same provenance helper the designer uses records it.
   */
  app.post('/api/concepts/:id/reroll-lyrics', (req: Request, res: Response) => {
    const concept = getConcept(String(req.params.id));
    if (!concept) {
      res.status(404).json({ error: 'concept not found' });
      return;
    }

    const body = (req.body ?? {}) as { agent?: string; seed?: number };
    const brief = latestBrief(concept.market);
    const flavor = flavorFor(concept.market);
    const requestedLanguage =
      typeof concept.params.requestedLanguage === 'string'
        ? concept.params.requestedLanguage
        : concept.vocalLanguage;

    const plan = writeLyrics({
      themes: flavor.themes,
      terms: (brief?.topTerms ?? []).map((term) => term.term),
      energy: GENRE_STYLE[concept.primaryGenre]?.energy ?? 0.6,
      language: requestedLanguage,
      genre: concept.primaryGenre,
      seed: typeof body.seed === 'number' ? body.seed : undefined,
      agent: typeof body.agent === 'string' && body.agent.length > 0 ? body.agent : undefined,
      instrumental: concept.instrumental,
    });

    const validation = validateLyricPlan(plan, {
      bpm: concept.bpm,
      timeSignature: concept.timeSignature,
    });

    const updated = updateConceptLyrics(
      concept.id,
      plan.lyrics,
      plan.language,
      lyricProvenance(plan, validation),
    );

    res.json({
      concept: updated,
      style: { id: plan.agent, name: plan.agentName, source: plan.agentSource, realised: plan.agentRealised },
      subject: { id: plan.subject, label: plan.subjectLabel, source: plan.subjectSource },
      validation: { score: validation.score, meterFit: validation.meterFit, issues: validation.issues },
    });
  });

  app.get('/api/concepts', (req: Request, res: Response) => {
    res.json({
      concepts: listConcepts({
        market: req.query.market ? String(req.query.market).toLowerCase() : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      }),
    });
  });

  app.get('/api/concepts/:id', (req: Request, res: Response) => {
    const concept = getConcept(String(req.params.id));
    if (!concept) {
      res.status(404).json({ error: 'concept not found' });
      return;
    }
    res.json({ concept });
  });

  /** Augmentation: user edits to a design before it is generated. */
  app.patch('/api/concepts/:id', (req: Request, res: Response) => {
    const updated = updateConceptFields(String(req.params.id), (req.body ?? {}) as ConceptPatch);
    if (!updated) {
      res.status(404).json({ error: 'concept not found' });
      return;
    }
    res.json({ concept: updated });
  });

  /**
   * Renders one concept. Starts the job and returns immediately with the run id:
   * generation takes minutes, so the client polls GET /api/runs/:id.
   * Body may include `{ patch: {...} }` to apply edits first.
   */
  app.post('/api/concepts/:id/run', async (req: Request, res: Response) => {
    const conceptId = String(req.params.id);
    const patch = (req.body?.patch ?? null) as ConceptPatch | null;
    const concept = patch ? updateConceptFields(conceptId, patch) : getConcept(conceptId);

    if (!concept) {
      res.status(404).json({ error: 'concept not found' });
      return;
    }

    const health = await pipeline.health();
    if (!health.ok) {
      res.status(503).json({ error: `pipeline unavailable: ${health.detail ?? 'unknown error'}` });
      return;
    }

    let resolveRunId: (id: string) => void = () => undefined;
    const runIdPromise = new Promise<string>((resolve) => {
      resolveRunId = resolve;
    });

    executeConcept(concept, {
      onRunCreated: (id) => resolveRunId(id),
      onEvent: (message) => console.log(`[ui-run] ${message}`),
    }).then((result) => {
      if (result.status === 'failed') console.error(`[ui-run] run ${result.runId} failed: ${result.error}`);
      else console.log(`[ui-run] run ${result.runId} succeeded (composite ${result.composite ?? '-'})`);
    }).catch((error) => console.error('[ui-run] unexpected error:', error));

    const runId = await runIdPromise;
    res.status(202).json({ runId, conceptId: concept.id, market: concept.market, status: 'running' });
  });

  app.get('/api/runs/:id', (req: Request, res: Response) => {
    const run = getRun(String(req.params.id));
    if (!run) {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    res.json({ run: serializeRun(run) });
  });

  return app;
}

export function startServer(): void {
  const app = createApp();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`signal-aggregator listening on http://localhost:${config.port}`);
    console.log(`markets: ${config.markets.join(', ')}`);
    console.log(`pipeline: ${pipeline.baseUrl}`);
  });
}