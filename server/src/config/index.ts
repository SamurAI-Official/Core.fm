import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveAceStepDir } from './acestepPath.js';

// Load the app's .env from the repo root explicitly, and do it *before* the config
// object below is built.
//
// Why the explicit path matters: `config.datasets` is evaluated at module-load time,
// and `src/index.ts` imports this module before its own dotenv call runs - so an
// ACESTEP_PATH defined in the repo-root .env used to arrive too late to influence the
// training dataset paths (it silently fell back to a default directory the engine
// never reads). The previous cwd-based call looked in server/.env, not the repo root.
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // SQLite database
  database: {
    path: process.env.DATABASE_PATH || path.join(__dirname, '../../data/acestep.db'),
  },

  // ACE-Step API (local)
  acestep: {
    apiUrl: process.env.ACESTEP_API_URL || 'http://localhost:8001',
  },

  // Signal aggregator (local). Verdicts on a song are forwarded here so a dislike can reach the
  // market weights that designed the song. It is optional: if it is down, or the song has no market
  // attribution (a plain Create-tab generation), the verdict is still recorded locally and simply
  // does not learn.
  aggregator: {
    url: (process.env.AGGREGATOR_URL || process.env.SIGNAL_AGGREGATOR_URL || 'http://localhost:3002').replace(/\/$/, ''),
    /** How long to wait for the aggregator before giving up on the learning half of a verdict. */
    timeoutMs: parseInt(process.env.AGGREGATOR_TIMEOUT_MS || '5000', 10),
  },

  // Pexels (optional - for video backgrounds)
  pexels: {
    apiKey: process.env.PEXELS_API_KEY || '',
  },

  // Frontend URL
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  // Storage (local only)
  storage: {
    provider: 'local' as const,
    audioDir: process.env.AUDIO_DIR || path.join(__dirname, '../../public/audio'),
  },

  // Training datasets (inside ACE-Step-1.5 so Gradio can access them)
  datasets: {
    // Training datasets (inside ACE-Step-1.5 so Gradio can reach them). Resolved via
    // resolveAceStepDir() so ACESTEP_PATH is honoured - the previous hardcoded relative
    // path ignored it and pointed at a directory that does not exist when the engine is
    // a sibling of this repo rather than nested inside it.
    dir: process.env.DATASETS_DIR || path.join(resolveAceStepDir(), 'datasets'),
    uploadsDir: process.env.DATASETS_UPLOADS_DIR || path.join(resolveAceStepDir(), 'datasets/uploads'),
  },

  // Simplified JWT (for local session, not critical security)
  jwt: {
    secret: process.env.JWT_SECRET || 'ace-step-ui-local-secret',
    expiresIn: '365d', // Long-lived for local app
  },
};
