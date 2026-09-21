/**
 * Minimal argv parsing for the CLI (`--flag` and `--key value`).
 */
import { config } from '../config.js';

export interface Args {
  flags: Set<string>;
  values: Map<string, string>;
}

export function parseArgs(argv: string[]): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(key, next);
      index += 1;
    } else {
      flags.add(key);
    }
  }
  return { flags, values };
}

export function marketsFrom(args: Args): string[] {
  const raw = args.values.get('markets');
  if (!raw) return config.markets;
  return raw
    .split(',')
    .map((market) => market.trim().toLowerCase())
    .filter(Boolean);
}

export function numberFrom(args: Args, key: string, fallback: number): number {
  const raw = args.values.get(key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function optionalNumber(args: Args, key: string): number | undefined {
  const raw = args.values.get(key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Reads an option npm may have taken for itself.
 *
 * `npm run <script> -- --market us --dry-run` does not reliably deliver those options to the
 * script: npm treats recognised ones as its own config and hands the child `npm_config_market`
 * and `npm_config_dry_run` instead. An operator who passes `--dry-run` and gets a run that
 * writes anyway is the worst version of this, so commands that destroy or rewrite data read both
 * spellings. Values arrive as strings ('true'/'false'), and a bare flag may arrive empty.
 */
export function envFlag(...names: string[]): boolean {
  return names.some((name) => {
    const raw = process.env[name];
    return raw === 'true' || raw === '1' || raw === '';
  });
}

export function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const raw = process.env[name];
    if (raw !== undefined && raw !== '') return raw;
  }
  return undefined;
}

export const log = (message: string): void => console.log(message);