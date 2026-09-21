/**
 * Concept persistence.
 */
import { pool, jsonParse } from '../db/index.js';
import { uuid } from '../lib/util.js';
import type { Concept } from './types.js';

export function insertConcept(concept: Omit<Concept, 'id' | 'createdAt'> & { id?: string }): Concept {
  const id = concept.id ?? uuid();
  const createdAt = new Date().toISOString();
  pool.query(
    `INSERT INTO concepts (id, market, brief_id, created_at, status, title, style, lyrics, instrumental,
                           vocal_language, bpm, key_scale, time_signature, duration, batch_size, thinking,
                           enhance, primary_genre, seed, rationale, params)
     VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      concept.market,
      concept.briefId ?? null,
      concept.status,
      concept.title,
      concept.style,
      concept.lyrics ?? '',
      concept.instrumental ? 1 : 0,
      concept.vocalLanguage,
      concept.bpm,
      concept.keyScale,
      concept.timeSignature,
      concept.duration,
      concept.batchSize,
      concept.thinking ? 1 : 0,
      concept.enhance ? 1 : 0,
      concept.primaryGenre,
      concept.seed,
      concept.rationale,
      JSON.stringify(concept.params ?? {}),
    ],
  );
  return { ...concept, id, createdAt };
}

function mapConcept(row: Record<string, unknown>): Concept {
  return {
    id: String(row.id),
    market: String(row.market),
    briefId: row.brief_id ? String(row.brief_id) : null,
    createdAt: String(row.created_at),
    status: String(row.status) as Concept['status'],
    title: String(row.title),
    style: String(row.style),
    lyrics: String(row.lyrics ?? ''),
    instrumental: Boolean(row.instrumental),
    vocalLanguage: String(row.vocal_language ?? 'en'),
    bpm: Number(row.bpm ?? 0),
    keyScale: String(row.key_scale ?? ''),
    timeSignature: String(row.time_signature ?? '4/4'),
    duration: Number(row.duration ?? 120),
    batchSize: Number(row.batch_size ?? 1),
    thinking: Boolean(row.thinking),
    enhance: Boolean(row.enhance),
    primaryGenre: String(row.primary_genre ?? 'other'),
    seed: Number(row.seed ?? 0),
    rationale: String(row.rationale ?? ''),
    params: jsonParse<Record<string, unknown>>(row.params, {}),
  };
}

/** Fields a user may edit to augment a design before generating it. */
export interface ConceptPatch {
  title?: string;
  style?: string;
  lyrics?: string;
  instrumental?: boolean;
  vocalLanguage?: string;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  duration?: number;
  batchSize?: number;
  thinking?: boolean;
  enhance?: boolean;
  primaryGenre?: string;
}

/**
 * Applies user edits to a concept (the "augment" step). Only whitelisted columns
 * are writable, numbers are clamped to sane ranges, and the params snapshot is
 * refreshed so the pipeline call matches what the user sees.
 */
export function updateConceptFields(id: string, patch: ConceptPatch): Concept | null {
  const current = getConcept(id);
  if (!current) return null;

  const next = {
    title: (patch.title ?? current.title).toString().slice(0, 120),
    style: (patch.style ?? current.style).toString().slice(0, 1200),
    lyrics: patch.lyrics === undefined ? current.lyrics : patch.lyrics.toString().slice(0, 8000),
    instrumental: patch.instrumental ?? current.instrumental,
    vocalLanguage: (patch.vocalLanguage ?? current.vocalLanguage).toString().slice(0, 10),
    bpm: Math.round(Math.min(220, Math.max(40, patch.bpm ?? current.bpm))),
    keyScale: (patch.keyScale ?? current.keyScale).toString().slice(0, 24),
    timeSignature: (patch.timeSignature ?? current.timeSignature).toString().slice(0, 8),
    duration: Math.round(Math.min(300, Math.max(15, patch.duration ?? current.duration))),
    batchSize: Math.round(Math.min(8, Math.max(1, patch.batchSize ?? current.batchSize))),
    thinking: patch.thinking ?? current.thinking,
    enhance: patch.enhance ?? current.enhance,
    primaryGenre: (patch.primaryGenre ?? current.primaryGenre).toString().slice(0, 40),
  };

  pool.query(
    `UPDATE concepts SET title = ?, style = ?, lyrics = ?, instrumental = ?, vocal_language = ?,
                         bpm = ?, key_scale = ?, time_signature = ?, duration = ?, batch_size = ?,
                         thinking = ?, enhance = ?, primary_genre = ?, params = ?
     WHERE id = ?`,
    [
      next.title,
      next.style,
      next.lyrics,
      next.instrumental ? 1 : 0,
      next.vocalLanguage,
      next.bpm,
      next.keyScale,
      next.timeSignature,
      next.duration,
      next.batchSize,
      next.thinking ? 1 : 0,
      next.enhance ? 1 : 0,
      next.primaryGenre,
      JSON.stringify({ ...current.params, augmented: true, augmentedAt: new Date().toISOString() }),
      id,
    ],
  );

  return getConcept(id);
}

/**
 * Replaces a concept's lyrics and merges fresh provenance into its params.
 *
 * The reroll path needs its own function: `updateConceptFields` writes whitelisted columns
 * only, and merging through it would leave the *old* lyric provenance (subject, style,
 * validation) sitting next to the new lyrics. Status returns to `designed`, because any
 * render that already happened no longer matches what is stored.
 *
 * `rationale` is optional and exists for the bulk rewrite: the prose names the subject, the
 * writing style and the singability score, so a rewritten concept whose rationale still named the
 * previous subject would read as another song's notes. Callers that leave it out keep the old
 * text, which is what the single-concept reroll endpoint does.
 */
export function updateConceptLyrics(
  id: string,
  lyrics: string,
  vocalLanguage: string,
  params: Record<string, unknown>,
  rationale?: string,
): Concept | null {
  const current = getConcept(id);
  if (!current) return null;
  pool.query(
    `UPDATE concepts SET lyrics = ?, vocal_language = ?, params = ?, rationale = ?, status = 'designed' WHERE id = ?`,
    [
      lyrics,
      vocalLanguage,
      JSON.stringify({ ...current.params, ...params, rerolledAt: new Date().toISOString() }),
      rationale ?? current.rationale,
      id,
    ],
  );
  return getConcept(id);
}

export function getConcept(id: string): Concept | null {
  const { rows } = pool.query<Record<string, unknown>>('SELECT * FROM concepts WHERE id = ?', [id]);
  return rows[0] ? mapConcept(rows[0]) : null;
}

export function listConcepts(options: { market?: string; status?: string; limit?: number } = {}): Concept[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.market) {
    clauses.push('market = ?');
    params.push(options.market);
  }
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(options.limit ?? 50);
  const { rows } = pool.query<Record<string, unknown>>(
    `SELECT * FROM concepts ${where} ORDER BY created_at DESC LIMIT ?`,
    params,
  );
  return rows.map(mapConcept);
}

export function updateConceptStatus(id: string, status: Concept['status']): void {
  pool.query('UPDATE concepts SET status = ? WHERE id = ?', [status, id]);
}

/** Distinct titles already used in a market, to avoid repeat designs. */
export function usedTitles(market: string, limit = 200): string[] {
  const { rows } = pool.query<{ title: string }>(
    'SELECT title FROM concepts WHERE market = ? ORDER BY created_at DESC LIMIT ?',
    [market, limit],
  );
  return rows.map((row) => row.title);
}

/**
 * Writing styles recently used in a market, newest first.
 *
 * Read back from the stored designs (`params.lyricAgent`) for the same reason subjects are:
 * rotation then survives a restart and reflects what was really designed, and a concept
 * written before writing styles existed simply contributes nothing.
 */
export function usedAgents(market: string, limit = 24): string[] {
  const { rows } = pool.query<{ params: string }>(
    'SELECT params FROM concepts WHERE market = ? ORDER BY created_at DESC LIMIT ?',
    [market, limit],
  );
  const agents: string[] = [];
  for (const row of rows) {
    const agent = jsonParse<Record<string, unknown>>(row.params, {}).lyricAgent;
    if (typeof agent === 'string' && agent.length > 0 && !agents.includes(agent)) agents.push(agent);
  }
  return agents;
}

/**
 * Subjects already written for a market, newest first.
 *
 * Read back from the stored designs (`params.lyricSubject`) rather than kept in
 * memory, so rotation survives a restart and reflects what was actually designed.
 * A concept predating the subject engine simply contributes nothing.
 */
export function usedSubjects(market: string, limit = 24): string[] {
  const { rows } = pool.query<{ params: string }>(
    'SELECT params FROM concepts WHERE market = ? ORDER BY created_at DESC LIMIT ?',
    [market, limit],
  );
  const subjects: string[] = [];
  for (const row of rows) {
    const subject = jsonParse<Record<string, unknown>>(row.params, {}).lyricSubject;
    if (typeof subject === 'string' && subject.length > 0 && !subjects.includes(subject)) {
      subjects.push(subject);
    }
  }
  return subjects;
}