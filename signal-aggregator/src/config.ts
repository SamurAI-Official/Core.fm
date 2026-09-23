import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_MARKETS } from './markets.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function num(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  // Trimmed, because `set FLAG=true && next-command` is a shell idiom that stores "true " with a
  // trailing space: without this, a flag set that way read as false and the feature it guards stayed
  // silently off. A correct value is unaffected; only whitespace-padded ones change meaning.
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const items = value
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

export const config = {
  port: num(process.env.PORT, 3002),
  dbPath: process.env.DB_PATH || path.join(__dirname, '../data/signals.db'),

  markets: list(process.env.MARKETS, DEFAULT_MARKETS),

  collection: {
    appleChartSize: num(process.env.APPLE_CHART_SIZE, 50),
    deezerChartSize: num(process.env.DEEZER_CHART_SIZE, 50),
    timeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 20000),
    retries: num(process.env.REQUEST_RETRIES, 3),
  },

  /**
   * Periodic collection. Off by default so a CLI invocation never starts a timer
   * behind the operator's back; `serve` opts in via .env or --schedule.
   */
  schedule: {
    enabled: bool(process.env.SCHEDULE_ENABLED, false),
    intervalMinutes: num(process.env.SCHEDULE_INTERVAL_MINUTES, 360),
    enrichTop: num(process.env.SCHEDULE_ENRICH_TOP, 20),
    briefAfterCollect: bool(process.env.SCHEDULE_BRIEF, true),
    runOnStart: bool(process.env.SCHEDULE_RUN_ON_START, true),
  },

  forecast: {
    horizonDays: num(process.env.FORECAST_HORIZON_DAYS, 7),
    /** Minimum projected rank gain for a track to appear on the rising board. */
    minGain: num(process.env.FORECAST_MIN_GAIN, 0.5),
    /** Only design against the forecast when history reaches this depth or better. */
    minDesignDepth: (process.env.FORECAST_MIN_DESIGN_DEPTH || 'moderate') as
      | 'insufficient'
      | 'low'
      | 'moderate'
      | 'high',
  },

  pipeline: {
    baseUrl: (process.env.ACESTEP_UI_URL || 'http://localhost:3001').replace(/\/$/, ''),
    username: process.env.ACESTEP_UI_USERNAME || 'signal-aggregator',
    pollMs: num(process.env.PIPELINE_POLL_MS, 5000),
    timeoutMs: num(process.env.PIPELINE_TIMEOUT_MS, 900000),
  },

  design: {
    conceptsPerMarket: num(process.env.CONCEPTS_PER_MARKET, 3),
    batchSize: num(process.env.BATCH_SIZE, 1),
    thinking: bool(process.env.THINKING, true),
    enhance: bool(process.env.ENHANCE, true),
    duration: num(process.env.DURATION, 120),
    inferenceSteps: num(process.env.INFERENCE_STEPS, 8),
    guidanceScale: num(process.env.GUIDANCE_SCALE, 7.0),
    audioFormat: (process.env.AUDIO_FORMAT || 'mp3') as 'mp3' | 'flac',
  },

  scoring: {
    weightMarketFit: num(process.env.WEIGHT_MARKET_FIT, 0.5),
    weightNovelty: num(process.env.WEIGHT_NOVELTY, 0.2),
    weightHuman: num(process.env.WEIGHT_HUMAN, 0.3),
    championThreshold: num(process.env.CHAMPION_THRESHOLD, 0.7),
    viableThreshold: num(process.env.VIABLE_THRESHOLD, 0.55),
    learningRate: num(process.env.LEARNING_RATE, 0.25),
    /**
     * How fast an untouched weight walks back toward neutral, per week.
     *
     * The mirror of `learningRate`: that is how fast a listener can move a weight, this is how fast the
     * weight lets go of them. At the default 2%/week a key driven to its 0.25 floor is back to about
     * 0.9 in ten weeks, and a key that keeps being confirmed never moves at all.
     */
    decayPerWeek: num(process.env.WEIGHT_DECAY_PER_WEEK, 0.02),
  },

  /**
   * Listener preference (the dislike button) and how much agreement a market's weights require.
   *
   * A verdict is recorded the moment it arrives and is visible in the ledger, but it does not move a
   * market's weights on one listener's word: `minUsers` distinct raters have to agree on the same key
   * within `windowDays`. Without that gate the first person to find the button shapes the market.
   * A single-user deployment can set FEEDBACK_MIN_USERS=1 to see it act immediately.
   */
  feedback: {
    minUsers: num(process.env.FEEDBACK_MIN_USERS, 3),
    windowDays: num(process.env.FEEDBACK_WINDOW_DAYS, 30),
    /** Off = record votes and report what is pending, but never move a market's weights. */
    promote: bool(process.env.FEEDBACK_PROMOTE, true),
    /**
     * How many verdicts one listener may act with per window. `0` means unlimited.
     *
     * Agreement is counted in people and magnitude in votes, so one listener judging hundreds of
     * responses can add unbounded magnitude once others agree - and can drive their own profile to its
     * floor alone. This bounds both.
     */
    maxVerdictsPerDay: num(process.env.FEEDBACK_MAX_VERDICTS_PER_DAY, 100),
    rateLimitWindowHours: num(process.env.FEEDBACK_RATE_LIMIT_WINDOW_HOURS, 24),
  },

  /**
   * The soft-tuning loop (Layer 2): how a candidate edition is built and whether it is adopted.
   *
   * Every number here is a guard against a specific way this loop goes wrong, which is why they are
   * named rather than buried: a mix with too few anchors collapses onto its own output, a mix with too
   * many negatives learns to avoid everything, too few held-out pairs cannot tell two editions apart,
   * and a loop with no stop rule will tune for ever.
   */
  edition: {
    /** Share of *prompts* held out. Split by prompt, so a held-out pair is an unseen prompt. */
    heldOutShare: num(process.env.EDITION_HELD_OUT_SHARE, 0.3),
    /** Negatives per positive in the mix: stops dislikes teaching it to avoid everything. */
    maxNegativesPerPositive: num(process.env.EDITION_MAX_NEGATIVES_PER_POSITIVE, 2),
    /** Designs with no verdict that must stay in the mix: the chart material and the curated baseline. */
    minAnchors: num(process.env.EDITION_MIN_ANCHORS, 8),
    /** Below this the corpus is too thin to train on, and says so instead of training anyway. */
    minTrainSamples: num(process.env.EDITION_MIN_TRAIN_SAMPLES, 8),
    /** Held-out pairs needed before a candidate may be judged at all. */
    minHeldOutPairs: num(process.env.EDITION_MIN_HELD_OUT_PAIRS, 5),
    /** Preference accuracy a candidate must reach on held-out pairs. */
    minWinRate: num(process.env.EDITION_MIN_WIN_RATE, 0.6),
    /** Consecutive candidates that fail to win before the loop stops and waits for a human. */
    maxNoWinTrials: num(process.env.EDITION_MAX_NO_WIN_TRIALS, 3),
    /** Where corpora and adapter references are written (beside the database by default). */
    corpusDir: process.env.EDITION_CORPUS_DIR || '',
  },

  keys: {
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    lastfmApiKey: process.env.LASTFM_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
  },
};

export type Config = typeof config;
