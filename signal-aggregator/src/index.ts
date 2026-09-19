#!/usr/bin/env node
/**
 * CLI entry point.
 *
 *   npm run collect -- --markets us,ng --enrich 20
 *   npm run brief   -- --markets us,ng
 *   npm run design  -- --count 2 --seed 42
 *   npm run run     -- --limit 2
 *   npm run cycle   -- --markets us,ng --per-market 2 --generate 2
 *   npm run report  -- --market us
 *   npm run forecast -- --market us --horizon 7
 *   npm run schedule -- --interval 360        (long-running periodic collection)
 *   npm run serve    -- --schedule            (API + dashboard, with the scheduler on)
 */
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { collectSignals } from './sources/collect.js';
import { buildBriefs, latestBrief } from './briefs/build.js';
import { listConcepts } from './design/store.js';
import { designConcepts } from './design/designer.js';
import { getWeights } from './loops/ratings.js';
import { executeConcepts } from './pipeline/run.js';
import { rateRun } from './loops/rate.js';
import { runCycle } from './loops/cycle.js';
import { marketOverview, renderOverviewText } from './report/overview.js';
import { renderMarketText, renderCycleText } from './report/detail.js';
import { renderForecastOverview, renderForecastText } from './report/forecast.js';
import { forecastMarkets } from './forecast/forecast.js';
import { startScheduler } from './schedule/scheduler.js';
import { pipeline } from './pipeline/client.js';
import { log, marketsFrom, numberFrom, optionalNumber, parseArgs } from './cli/args.js';

async function main(): Promise<void> {
  const [command = 'report', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  runMigrations();

  switch (command) {
    case 'serve': {
      const { startServer } = await import('./api/server.js');
      startServer();
      // Opt-in: an operator running `serve` should not silently start hammering
      // the chart APIs, but when enabled the history grows without being asked.
      if (config.schedule.enabled || args.flags.has('schedule')) {
        startScheduler({ onEvent: log });
      }
      return;
    }

    case 'schedule': {
      const status = startScheduler({
        onEvent: log,
        intervalMinutes: numberFrom(args, 'interval', config.schedule.intervalMinutes),
        runImmediately: !args.flags.has('no-run-now'),
      });
      log('');
      log(`scheduler active: every ${status.intervalMinutes} min. Leave this process running; ctrl-c to stop.`);
      return;
    }

    case 'forecast': {
      const market = args.values.get('market')?.toLowerCase();
      const markets = market ? [market] : marketsFrom(args);
      const horizonDays = numberFrom(args, 'horizon', config.forecast.horizonDays);
      const forecasts = forecastMarkets(markets, { horizonDays });
      log('');
      log(markets.length === 1 ? renderForecastText(forecasts[0]) : renderForecastOverview(forecasts));
      return;
    }

    case 'collect': {
      const markets = marketsFrom(args);
      log(`collecting signals for ${markets.join(', ')}`);
      const report = await collectSignals({
        markets,
        enrichTop: numberFrom(args, 'enrich', 20),
        includeGlobal: !args.flags.has('no-global'),
        onEvent: log,
      });
      log('');
      log(`collected ${report.totalTracks} signals (${report.enriched} enriched, ${report.errors} source errors)`);
      for (const outcome of report.outcomes) {
        log(
          `  ${outcome.market.padEnd(8)} ${outcome.source.padEnd(20)} ${String(outcome.count).padStart(4)} tracks` +
            `${outcome.enriched ? ` (${outcome.enriched} enriched)` : ''}` +
            `${outcome.error ? ` - ERROR ${outcome.error}` : ''}`,
        );
      }
      return;
    }

    case 'brief': {
      const briefs = buildBriefs(marketsFrom(args));
      log('');
      for (const brief of briefs) {
        log(`${brief.market} - ${brief.summary}`);
        log('');
      }
      return;
    }

    case 'design': {
      const markets = marketsFrom(args);
      const count = numberFrom(args, 'count', config.design.conceptsPerMarket);
      const seed = optionalNumber(args, 'seed');
      const concepts = markets.flatMap((market) => {
        const brief = latestBrief(market);
        if (!brief) {
          log(`skip ${market}: no brief yet (run: npm run collect && npm run brief)`);
          return [];
        }
        return designConcepts({
          market,
          brief,
          count,
          learnedWeights: getWeights(market),
          seed,
          instrumental: args.flags.has('instrumental'),
        });
      });
      log(`designed ${concepts.length} concept(s):`);
      for (const concept of concepts) {
        log('');
        log(
          `${concept.market} | ${concept.title} | ${concept.primaryGenre} | ${concept.bpm} bpm | ${concept.keyScale} | ` +
            `${concept.timeSignature} | ${concept.duration}s | ${concept.vocalLanguage}${concept.instrumental ? ' | instrumental' : ''}`,
        );
        log(`  style: ${concept.style}`);
        log(`  why  : ${concept.rationale}`);
        const arcSummary = concept.params?.lyricArcSummary;
        const hook = concept.params?.hook;
        if (typeof hook === 'string') log(`  hook : ${hook}`);
        if (typeof arcSummary === 'string') log(`  arc  : ${arcSummary}`);
      }
      return;
    }

    case 'run': {
      const limit = numberFrom(args, 'limit', 1);
      const market = args.values.get('market');
      const pending = listConcepts({ market, status: 'designed', limit });
      if (pending.length === 0) {
        log('no designed concepts waiting; run: npm run design');
        return;
      }
      const health = await pipeline.health();
      log(`pipeline ${health.ok ? 'healthy' : `unavailable (${health.detail ?? 'unknown'})`}`);
      if (!health.ok) return;
      const results = await executeConcepts(pending, { onEvent: log });
      log('');
      for (const result of results) {
        log(
          `${result.market} | ${result.status} | composite ${result.composite ?? '-'} | ${result.verdict ?? '-'}` +
            `${result.error ? ` | ${result.error}` : ''}`,
        );
        for (const file of result.audioPaths) log(`  audio: ${file}`);
      }
      return;
    }

    case 'cycle': {
      const report = await runCycle({
        markets: marketsFrom(args),
        perMarket: numberFrom(args, 'per-market', config.design.conceptsPerMarket),
        generateLimit: numberFrom(args, 'generate', 0),
        reuseSignals: args.flags.has('reuse'),
        enrichTop: numberFrom(args, 'enrich', 10),
        seed: optionalNumber(args, 'seed'),
        instrumental: args.flags.has('instrumental'),
        onEvent: log,
      });
      log('');
      log(renderCycleText(report));
      return;
    }

    case 'rate': {
      const runId = args.values.get('run');
      const score = optionalNumber(args, 'score');
      if (!runId || score === undefined) {
        log('usage: rate --run <runId> --score 0..1 [--notes "..."]');
        return;
      }
      const result = rateRun({ runId, score, notes: args.values.get('notes') });
      log(`rated ${result.runId} in ${result.market}: ${result.rating}`);
      log(`composite ${result.composite} (fit ${result.marketFit}, novelty ${result.novelty}) -> ${result.verdict}`);
      if (result.learning.length > 0) log(`weights updated: ${result.learning.join(', ')}`);
      return;
    }

    case 'stats': {
      log(JSON.stringify(marketOverview(), null, 2));
      return;
    }

    case 'report':
    default: {
      const market = args.values.get('market');
      if (market) {
        log(renderMarketText(market.toLowerCase()));
        return;
      }
      const status = await pipeline.health();
      log(`pipeline: ${status.ok ? 'healthy' : 'unavailable'} (${status.url || pipeline.baseUrl})`);
      log('');
      log(renderOverviewText());
      return;
    }
  }
}

main().catch((error) => {
  console.error('fatal:', error);
  process.exit(1);
});