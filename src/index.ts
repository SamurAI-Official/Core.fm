#!/usr/bin/env node
/**
 * CLI entry point.
 *
 *   npm run collect -- --markets us,ng --enrich 20
 *   npm run brief   -- --markets us,ng
 *   npm run design  -- --count 2 --seed 42
 *   npm run run     -- --limit 2
 *   npm run cycle   -- --markets us,ng --per-market 2 --generate 2
 *   npm run rewrite-lyrics -- --market us            (re-write stored lyrics from the sample)
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
import { rewriteLyrics } from './design/rewrite.js';
import { feedbackSummary, listFeedback } from './loops/feedback.js';
import { decayStatus, decayWeights, describeDecay } from './loops/decay.js';
import { currentEdition, describeEdition, listEditions, noWinTrials } from './loops/editions.js';
import { buildCorpus, describeCorpus, writeCorpus } from './design/editionCorpus.js';
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
import { envFlag, envValue, log, marketsFrom, numberFrom, optionalNumber, parseArgs } from './cli/args.js';

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
        const subjectLabel = concept.params?.lyricSubjectLabel;
        const subjectSource = concept.params?.lyricSubjectSource;
        if (typeof subjectLabel === 'string') {
          log(
            `  about: ${subjectLabel} (${concept.params?.lyricSubject}${
              typeof subjectSource === 'string' ? `, ${subjectSource}` : ''
            }${concept.params?.lyricSubjectRealised === false ? ', general material only' : ''})`,
          );
        }
        const agentName = concept.params?.lyricAgentName;
        if (typeof agentName === 'string') {
          log(
            `  writing: ${agentName} (${concept.params?.lyricAgent}${
              typeof concept.params?.lyricAgentSource === 'string'
                ? `, chosen by ${concept.params.lyricAgentSource}`
                : ''
            }${concept.params?.lyricAgentRealised === false ? ', pack lacks its primitives' : ''})`,
          );
        }
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

    case 'rewrite-lyrics': {
      // npm can consume `--market`, `--dry-run`, `--seed`, `--limit` and `--redraw` as its own
      // config when they follow the script name, so both spellings are read: a run that is asked
      // to be dry and writes anyway is the failure mode worth designing against.
      const market = (args.values.get('market') ?? envValue('npm_config_market'))?.toLowerCase();
      // A bare flag npm took for itself arrives as 'true', and a silently-empty scope is how a
      // rewrite looks like it did nothing. Market codes are ISO 3166-1 alpha-2, so anything else
      // is a mistake worth naming.
      if (market && !/^[a-z]{2}$/.test(market)) {
        log(
          `rewrite-lyrics: '${market}' is not a market code. npm takes --market for itself when it ` +
            `follows the script name - use --market=<cc>, or bypass npm with ` +
            `npx tsx src/index.ts rewrite-lyrics --market <cc>`,
        );
        return;
      }
      const seed = optionalNumber(args, 'seed') ?? Number(envValue('npm_config_seed') ?? NaN);
      const limit =
        numberFrom(args, 'limit', Number(envValue('npm_config_limit') ?? 1000));
      const dryRun = args.flags.has('dry-run') || args.flags.has('dryrun') || envFlag('npm_config_dry_run');
      const redrawStyles = args.flags.has('redraw') || envFlag('npm_config_redraw');

      log(
        `rewrite-lyrics | ${dryRun ? 'DRY RUN - nothing will be written' : 'writing'} | ` +
          `market: ${market ?? 'all'} | seed: ${Number.isFinite(seed) ? seed : 1} | ` +
          `styles: ${redrawStyles ? 'redrawn' : 'kept'} | limit: ${limit}`,
      );

      const report = rewriteLyrics({
        market,
        limit,
        seed: Number.isFinite(seed) ? seed : undefined,
        redrawStyles,
        dryRun,
        onEvent: log,
      });
      log('');
      for (const outcome of report.outcomes.slice(0, 12)) {
        log(
          `  ${outcome.market} | ${outcome.title.slice(0, 34).padEnd(34)} ${outcome.agent.padEnd(20)} ` +
            `${(outcome.beforeLineShare * 100).toFixed(0).padStart(3)}% -> ${(outcome.afterLineShare * 100).toFixed(0).padStart(3)}% ` +
            `(most-sung line ${outcome.beforeMostSung}x -> ${outcome.afterMostSung}x)`,
        );
      }
      if (report.outcomes.length > 12) log(`  ... and ${report.outcomes.length - 12} more`);
      if (report.stillOver > 0) log(`\n  note: ${report.stillOver} design(s) are still over the ceiling`);
      return;
    }

    case 'feedback': {
      // The ledger: what listeners said, and what they blamed. Prints without arguments; the
      // per-market weights it moved are in `report --market <cc>`.
      const summary = feedbackSummary();
      log('');
      log(
        `feedback: ${summary.total} recorded (${summary.likes} likes, ${summary.dislikes} dislikes, ` +
          `${summary.unattributed} dislikes with no reason given)`,
      );
      if (summary.byMarket.length > 0) {
        log('by market:');
        for (const entry of summary.byMarket) {
          log(`  ${entry.market.padEnd(4)} ${entry.likes} like(s), ${entry.dislikes} dislike(s)`);
        }
      }
      if (summary.reasons.length > 0) {
        log('reasons:');
        for (const entry of summary.reasons) log(`  ${entry.reason.padEnd(14)} ${entry.count}`);
      }
      for (const record of listFeedback({ limit: 10 })) {
        const named = record.reasons.length > 0 ? ` (${record.reasons.join(', ')})` : '';
        log(
          `  ${record.createdAt}  ${record.market ?? '-'}  ${record.verdict}${named}  ` +
            `${record.features.agent ?? '-'} / ${record.features.subject ?? '-'}`,
        );
      }
      return;
    }

    case 'decay': {
      // Weights walk back toward neutral when nobody has confirmed them for a while. Runs on its own at
      // startup, on every scheduled pass and at the head of a cycle; this is for watching it happen, or
      // for asking what it would do.
      // Both spellings, and npm's own config form: `npm run decay -- --dry-run` hands the child
      // `npm_config_dry_run` instead (see cli/args.ts), and a command that answers --dry-run by writing
      // is the worst version of this.
      const dryRun = args.flags.has('dry-run') || args.flags.has('dryrun') || envFlag('npm_config_dry_run');
      const report = decayWeights({ dryRun });
      const status = decayStatus();
      log('');
      log(
        `decay: ${(report.ratePerWeek * 100).toFixed(2)}%/week toward neutral` +
          (status.lastPassAt ? `, last pass ${status.lastPassAt}` : ', never run before') +
          (report.weeksSinceLastPass === null ? '' : ` (${report.weeksSinceLastPass}w ago)`) +
          (dryRun ? '  [DRY RUN - nothing written]' : ''),
      );
      for (const line of describeDecay(report)) log(`  ${line}`);
      return;
    }

    case 'editions': {
      // The registry: which model is in force, what each candidate was trained on, and how it was judged.
      const editions = listEditions();
      const current = currentEdition();
      const trials = noWinTrials();
      log('');
      log(
        `editions: ${editions.length} recorded | in force: ` +
          (current ? `#${current.ordinal} (${current.id.slice(0, 8)})` : 'the base model') +
          ` | rejected since the last adoption: ${trials}/${config.edition.maxNoWinTrials}`,
      );
      for (const edition of editions) log(`  ${describeEdition(edition)}`);
      return;
    }

    case 'edition-corpus': {
      // What the next edition would train on. Writing is opt-in: reading a corpus must not create files.
      const write = envFlag('npm_config_write') || args.flags.has('write') || args.values.get('write') === 'true';
      const corpus = buildCorpus();
      log('');
      for (const line of describeCorpus(corpus)) log(line);
      if (write && corpus.manifest.blockers.length === 0) {
        log(`  written to ${writeCorpus(corpus)}`);
      } else if (write) {
        log('  not written: the corpus has blockers (see above)');
      } else {
        log('  (nothing written - pass --write to save it)');
      }
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