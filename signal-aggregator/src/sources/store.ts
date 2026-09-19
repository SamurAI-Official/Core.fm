/**
 * Persistence helpers for collected signals and the small meta key/value store.
 */
import { pool, jsonParse } from '../db/index.js';
import { sha256, trackKey, uuid } from '../lib/util.js';
import type { SignalTrack } from './types.js';

export interface SignalRow {
  id: string;
  snapshot_id: string;
  market: string;
  source: string;
  captured_at: string;
  rank: number | null;
  title: string;
  artist: string | null;
  external_id: string | null;
  url: string | null;
  genres: string[];
  canonical_genres: string[];
  duration_ms: number | null;
  release_date: string | null;
  enriched: number;
  bpm: number | null;
}

export function insertSnapshot(
  market: string,
  source: string,
  trackCount: number,
  payloadHash?: string,
  error?: string,
): string {
  const id = uuid();
  pool.query(
    `INSERT INTO signal_snapshots (id, market, source, track_count, payload_hash, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, market, source, trackCount, payloadHash ?? null, error ?? null],
  );
  return id;
}

/**
 * Inserts signals and returns their ids in insertion order, so callers can align
 * enrichment work with the collected tracks (ranks repeat across Deezer's
 * per-genre charts, so ordering by rank would misalign).
 */
export function insertSignals(snapshotId: string, tracks: SignalTrack[]): string[] {
  const ids: string[] = [];
  if (tracks.length === 0) return ids;

  for (const track of tracks) {
    const id = uuid();
    pool.query(
      `INSERT INTO signals (id, snapshot_id, market, source, rank, title, artist, external_id, url,
                            genres, canonical_genres, duration_ms, release_date, raw, track_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        snapshotId,
        track.market,
        track.source,
        track.rank ?? null,
        track.title,
        track.artist ?? null,
        track.externalId ?? null,
        track.url ?? null,
        JSON.stringify(track.genres ?? []),
        JSON.stringify(track.canonicalGenres ?? []),
        track.durationMs ?? null,
        track.releaseDate ?? null,
        track.raw ? JSON.stringify(track.raw).slice(0, 20000) : null,
        trackKey(track.title, track.artist),
      ],
    );
    ids.push(id);
  }
  return ids;
}

/** Records enrichment results (canonical genre, duration, measured BPM). */
export function markEnriched(
  signalId: string,
  patch: { canonicalGenres?: string[]; durationMs?: number; releaseDate?: string; bpm?: number },
): void {
  pool.query(
    `UPDATE signals
     SET enriched = 1,
         canonical_genres = COALESCE(?, canonical_genres),
         duration_ms = COALESCE(?, duration_ms),
         release_date = COALESCE(?, release_date),
         bpm = COALESCE(?, bpm)
     WHERE id = ?`,
    [
      patch.canonicalGenres ? JSON.stringify(patch.canonicalGenres) : null,
      patch.durationMs ?? null,
      patch.releaseDate ?? null,
      patch.bpm ?? null,
      signalId,
    ],
  );
}

/** Adds a measured BPM to an existing signal row. */
export function setSignalBpm(signalId: string, bpm: number): void {
  pool.query('UPDATE signals SET bpm = ? WHERE id = ?', [bpm, signalId]);
}

function mapRow(row: Record<string, unknown>): SignalRow {
  return {
    ...(row as unknown as SignalRow),
    genres: jsonParse<string[]>(row.genres, []),
    canonical_genres: jsonParse<string[]>(row.canonical_genres, []),
  };
}

/** Newest snapshot per market+source (used to diff for momentum). */
export function latestSnapshotIds(market: string): Array<{ source: string; id: string; captured_at: string }> {
  const { rows } = pool.query<{ source: string; id: string; captured_at: string }>(
    `SELECT s.source, s.id, s.captured_at
     FROM signal_snapshots s
     JOIN (
       SELECT source, MAX(captured_at) AS newest
       FROM signal_snapshots
       WHERE market = ? AND error IS NULL
       GROUP BY source
     ) latest ON latest.source = s.source AND latest.newest = s.captured_at
     WHERE s.market = ?`,
    [market, market],
  );
  return rows;
}

/** Second-newest successful snapshot per market+source (the momentum baseline). */
export function previousSnapshotId(market: string, source: string, newerThanId: string): string | null {
  const { rows } = pool.query<{ id: string }>(
    `SELECT id FROM signal_snapshots
     WHERE market = ? AND source = ? AND error IS NULL AND id != ?
     ORDER BY captured_at DESC LIMIT 1`,
    [market, source, newerThanId],
  );
  return rows[0]?.id ?? null;
}

export function signalsForSnapshot(snapshotId: string, limit = 200): SignalRow[] {
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT * FROM signals WHERE snapshot_id = ? ORDER BY COALESCE(rank, 999) ASC LIMIT ?`,
    [snapshotId, limit],
  );
  return rows.map(mapRow);
}

export function latestSignals(market: string, limit = 500): SignalRow[] {
  const snapshots = latestSnapshotIds(market);
  if (snapshots.length === 0) return [];
  const placeholders = snapshots.map(() => '?').join(',');
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT * FROM signals
     WHERE snapshot_id IN (${placeholders})
     ORDER BY COALESCE(rank, 999) ASC
     LIMIT ?`,
    [...snapshots.map((s) => s.id), limit],
  );
  return rows.map(mapRow);
}

export function payloadHash(tracks: SignalTrack[]): string {
  return sha256(tracks.map((t) => `${t.rank ?? ''}:${t.artist ?? ''}:${t.title}`).join('|'));
}

export function getMeta(key: string): string | null {
  const { rows } = pool.query<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  return rows[0]?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  pool.query(
    `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, value],
  );
}