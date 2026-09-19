/**
 * SQLite access layer.
 *
 * Mirrors the `pool.query(sql, params) -> { rows, rowCount }` shape used by the
 * sibling ace-step-ui server so the two services read the same way, but this
 * service owns its own database file (no shared state with the UI).
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const sqlite = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export const pool = {
  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): QueryResult<T> {
    const statement = sqlite.prepare(sql);
    if (statement.reader) {
      const rows = statement.all(...(params as never[])) as T[];
      return { rows, rowCount: rows.length };
    }
    const info = statement.run(...(params as never[]));
    return { rows: [], rowCount: info.changes };
  },
};

export const db = sqlite;

/**
 * Runs a multi-statement SQL script (DDL). `pool.query` is for single statements
 * only, because better-sqlite3 prepares each one.
 */
export function exec(sql: string): void {
  sqlite.exec(sql);
}

export function jsonParse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}