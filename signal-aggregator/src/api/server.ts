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
import { getWeights, unratedRuns } from '../loops/ratings.js';
import { rateRun } from '../loops/rate.js';
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
      const { runId, score, notes, rater } = req.body as {
        runId?: unknown;
        score?: unknown;
        notes?: string;
        rater?: string;
      };
      if (typeof runId !== 'string' || !runId || typeof score !== 'number') {
        res.status(400).json({ error: 'runId (string) and score (number) are required' });
        return;
      }
      res.json(rateRun({ runId, score, notes, rater }));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
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