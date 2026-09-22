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
  findFeedbackBySource,
  insertFeedback,
  insertVotes,
  listFeedback,
  markWithdrawn,
} from '../loops/feedback.js';
import { pendingPromotions, promoteFeedback, withdrawFeedback } from '../loops/promotion.js';
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

export function createApp(): express.Express {
  runMigrations();

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
      const { market, verdict, score, reasons, features, source, learn, rater, sourceId } = req.body as {
        market?: unknown;
        verdict?: unknown;
        score?: unknown;
        reasons?: unknown;
        features?: unknown;
        source?: unknown;
        learn?: unknown;
        rater?: unknown;
        sourceId?: unknown;
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
        if (!marketCode || !raterId || !sourceKey) {
          res.json({
            verdict,
            market: marketCode ?? null,
            withdrawn: null,
            note: 'nothing to retract: market, rater and sourceId are all needed to find the verdict',
          });
          return;
        }
        const prior = findFeedbackBySource({ market: marketCode, rater: raterId, sourceId: sourceKey });
        if (!prior) {
          res.json({
            verdict,
            market: marketCode,
            withdrawn: null,
            note: 'no verdict of yours to retract on this response',
          });
          return;
        }
        const result = withdrawFeedback({ market: marketCode, feedbackId: prior.id });
        markWithdrawn(prior.id);
        res.json({
          verdict,
          market: marketCode,
          withdrawn: { id: prior.id, was: prior.verdict, ...result },
          notes: weightNotes(marketCode),
        });
        return;
      }

      const id = insertFeedback({
        market: marketCode,
        verdict,
        score: typeof score === 'number' ? score : undefined,
        reasons: reasonList,
        features: cleanFeatures,
        source: typeof source === 'string' ? source : 'api',
        rater: raterId,
        sourceId: sourceKey,
      });

      // `learn: false` records a preference without letting it act, so no votes are written at all - a
      // vote is the promise to act on agreement, and the caller declined exactly that.
      const plan =
        learn === false || !marketCode
          ? { steps: [], notes: [] }
          : planFeedback({
              market: marketCode,
              verdict,
              score: typeof score === 'number' ? score : undefined,
              reasons: reasonList,
              features: cleanFeatures,
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
        /** Keys still short of agreement, with how many listeners are with the caller so far. */
        pending,
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