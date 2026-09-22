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
  },

  keys: {
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    lastfmApiKey: process.env.LASTFM_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
  },
};

export type Config = typeof config;
