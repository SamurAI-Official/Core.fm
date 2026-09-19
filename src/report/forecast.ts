/**
 * Terminal rendering for market forecasts.
 *
 * The caveat is printed first and unmissably: a forecast table without its
 * sample-depth warning reads as authoritative, which it is not until the
 * scheduler has been running for days.
 */
import type { MarketForecast } from '../forecast/forecast.js';
import { bestGenreBet } from '../forecast/forecast.js';
import { cell, pct } from './format.js';

/** One market, in full. */
export function renderForecastText(forecast: MarketForecast): string {
  const lines: string[] = [];
  const { history } = forecast;

  lines.push(
    `${forecast.market.toUpperCase()} - ${history.passes} pass(es) over ${history.distinctDays} day(s) | ` +
      `history: ${forecast.depth} | first ${history.firstCapture ?? '-'} | last ${history.lastCapture ?? '-'}`,
  );

  if (forecast.caveat) {
    lines.push(`  WARNING: ${forecast.caveat}`);
  }

  const tempo = forecast.tempoProjection;
  lines.push(
    `  competition: median rank #${forecast.competitiveness.medianRank}, ` +
      `turbulence ${forecast.competitiveness.turbulence} rank-positions/day` +
      (tempo ? ` | projected tempo ~${tempo.bpm} BPM (${tempo.tempoClass}, conf ${tempo.confidence})` : ''),
  );

  const bet = bestGenreBet(forecast);
  if (bet) {
    const drift = `${bet.driftPerDay >= 0 ? '+' : ''}${(bet.driftPerDay * 100).toFixed(2)}pp/day`;
    lines.push(
      `  best genre bet: ${bet.genre} toward ${pct(bet.projectedShare, 1)} (drift ${drift}, conf ${bet.confidence})`,
    );
  } else {
    lines.push('  best genre bet: none confidently rising');
  }

  if (forecast.genreForecast.length > 0) {
    lines.push('  genre drift:');
    for (const genre of forecast.genreForecast.slice(0, 6)) {
      lines.push(
        `    ${cell(genre.genre, 24)} now ${pct(genre.currentShare, 1).padStart(6)} -> ` +
          `${pct(genre.projectedShare, 1).padStart(6)}  ${genre.direction.padEnd(8)} conf ${genre.confidence}`,
      );
    }
  }

  if (forecast.risingTracks.length === 0) {
    lines.push(`  rising board: empty (no track gained >= ${forecast.horizonDays}d of consistent movement)`);
  } else {
    lines.push(`  rising board (${forecast.horizonDays}d horizon):`);
    for (const track of forecast.risingTracks) {
      lines.push(
        `    ${cell(`${track.title} - ${track.artist ?? 'unknown'}`, 46)} ` +
          `#${track.currentRank} -> #${track.projectedRank} (+${track.expectedGain}) conf ${track.confidence}`,
      );
    }
  }

  return lines.join('\n');
}

/** All markets, plus a roll-up of which are usable yet. */
export function renderForecastOverview(forecasts: MarketForecast[]): string {
  const lines: string[] = [];
  const usable = forecasts.filter((f) => f.depth !== 'insufficient');
  const waiting = forecasts.filter((f) => f.depth === 'insufficient');

  lines.push(`forecast: ${usable.length}/${forecasts.length} market(s) have enough history`);
  lines.push('');

  for (const forecast of forecasts) {
    const bet = bestGenreBet(forecast);
    lines.push(
      `  ${cell(forecast.market.toUpperCase(), 6)} ${cell(forecast.depth, 13)} ` +
        `${cell(bet ? bet.genre : '-', 22)} ${cell(`${forecast.risingTracks.length} rising`, 12)}` +
        `${forecast.caveat ? 'needs more history' : `${forecast.horizonDays}d horizon`}`,
    );
  }

  if (waiting.length > 0) {
    lines.push('');
    lines.push(
      `  note: ${waiting.length} market(s) report insufficient history. ` +
        'Run `npm run schedule` or `collect` regularly - forecasting needs at least 2 collection passes on 2 separate days.',
    );
  }

  return lines.join('\n');
}