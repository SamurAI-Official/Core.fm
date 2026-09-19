/**
 * Small text formatting helpers shared by the reports.
 */
import type { RunRecord } from '../loops/store.js';

/** ASCII bar for terminal reports. */
export function bar(value: number, width = 18): string {
  const filled = Math.max(0, Math.min(width, Math.round(value * width)));
  return `${'#'.repeat(filled)}${'.'.repeat(width - filled)}`;
}

export function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function ts(value: string | null | undefined): string {
  return value ? value.slice(0, 19).replace('T', ' ') : '-';
}

export function describeRun(run: RunRecord): string {
  const composite = run.composite === null ? '-' : run.composite.toFixed(2);
  const detail = [
    `fit ${run.marketFit ?? '-'}`,
    `nov ${run.novelty ?? '-'}`,
    `comp ${composite}`,
    run.humanScore === null || run.humanScore === undefined ? 'unrated' : `human ${run.humanScore.toFixed(2)}`,
    run.verdict ?? '-',
  ].join(' | ');
  return `  ${ts(run.startedAt)} | ${run.status.padEnd(9)} | ${detail}${run.error ? ` | ${run.error}` : ''}`;
}

/** Pads/truncates a cell to a fixed width for aligned tables. */
export function cell(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, Math.max(0, width - 1))}~` : value.padEnd(width);
}