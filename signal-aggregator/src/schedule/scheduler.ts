/**
 * Background collection scheduler.
 *
 * Forecasting is a derivative, so the single most valuable thing this system can
 * do is collect regularly: every pass adds a point to each track's rank series.
 * Without a scheduler the history only grows when a human runs the CLI, which is
 * exactly the failure mode that leaves forecasts impossible.
 *
 * Deliberately simple: one timer, no overlap, no catch-up storms. If a run takes
 * longer than the interval the next tick is skipped rather than queued, so a slow
 * network can never pile up parallel collections against the public chart APIs.
 */
import { config } from '../config.js';
import { buildBriefs } from '../briefs/build.js';
import { collectSignals } from '../sources/collect.js';
import { setMeta } from '../sources/store.js';

export interface SchedulerState {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  runs: number;
  skipped: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastTracks: number | null;
  lastError: string | null;
  nextRunAt: string | null;
}

let state: SchedulerState = {
  enabled: false,
  running: false,
  intervalMinutes: 0,
  runs: 0,
  skipped: 0,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastTracks: null,
  lastError: null,
  nextRunAt: null,
};

let timer: ReturnType<typeof setTimeout> | null = null;
let stopped = true;

export function schedulerStatus(): SchedulerState {
  return { ...state };
}

/** One collection pass plus (optionally) refreshed briefs. Never throws. */
async function runOnce(log: (message: string) => void): Promise<void> {
  if (state.running) {
    state.skipped += 1;
    log('[schedule] previous collection still running - skipping this tick');
    return;
  }

  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  state.lastError = null;

  try {
    log(`[schedule] collecting signals for ${config.markets.join(', ')}`);
    const report = await collectSignals({
      markets: config.markets,
      enrichTop: config.schedule.enrichTop,
      onEvent: log,
    });
    state.lastTracks = report.totalTracks;
    if (report.errors > 0) {
      // Not fatal: adapters record per-source errors and the run still stored
      // whatever succeeded. Surfaced so a persistently failing feed is visible.
      state.lastError = `${report.errors} source error(s)`;
    }

    if (config.schedule.briefAfterCollect) {
      buildBriefs(config.markets);
      log('[schedule] market briefs refreshed');
    }

    state.runs += 1;
    setMeta('last_scheduled_collect_at', new Date().toISOString());
    log(`[schedule] pass complete: ${report.totalTracks} tracks, ${report.enriched} enriched`);
  } catch (error) {
    state.lastError = (error as Error).message || 'unknown error';
    log(`[schedule] collection failed: ${state.lastError}`);
  } finally {
    state.running = false;
    state.lastFinishedAt = new Date().toISOString();
  }
}

/**
 * Starts periodic collection. Safe to call once per process; a second call is
 * ignored rather than creating a competing timer.
 */
export function startScheduler(
  options: { onEvent?: (message: string) => void; intervalMinutes?: number; runImmediately?: boolean } = {},
): SchedulerState {
  const log = options.onEvent ?? ((message: string) => console.log(message));
  if (!stopped) return schedulerStatus();

  const intervalMinutes = options.intervalMinutes ?? config.schedule.intervalMinutes;
  const intervalMs = Math.max(1, intervalMinutes) * 60_000;

  stopped = false;
  state = {
    ...state,
    enabled: true,
    intervalMinutes,
  };

  const scheduleNext = (): void => {
    if (stopped) return;
    state.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    timer = setTimeout(() => {
      void runOnce(log).then(() => scheduleNext());
    }, intervalMs);
  };

  log(`[schedule] enabled: collecting every ${intervalMinutes} min for ${config.markets.join(', ')}`);
  if (options.runImmediately ?? config.schedule.runOnStart) {
    void runOnce(log).then(() => scheduleNext());
  } else {
    scheduleNext();
  }

  return schedulerStatus();
}

export function stopScheduler(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  state = { ...state, enabled: false, nextRunAt: null };
}

/** Runs one pass synchronously - used by the CLI and the dashboard button. */
export async function runScheduledPassNow(onEvent?: (message: string) => void): Promise<SchedulerState> {
  await runOnce(onEvent ?? ((message: string) => console.log(message)));
  return schedulerStatus();
}