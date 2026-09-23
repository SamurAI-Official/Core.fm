/**
 * The editions registry: which model is in force, what each one was trained on, and why it was adopted.
 *
 * An edition is a LoRA tuned from the previous one - consecutive tuning, never from scratch - on a
 * corpus drawn from the preference ledger plus the anchors that keep the mix from collapsing onto its own
 * output. This module is only the *record* of that: it holds no training code and makes no decisions, so
 * the loop's history can be audited independently of the machinery that produced it.
 *
 * Two invariants are enforced here rather than left to convention:
 *
 *   - **at most one adopted edition** (a partial unique index in the schema), because two incumbents make
 *     "the incumbent" ambiguous, and an ambiguous incumbent is how an uncontrolled loop decides;
 *   - **an edition cannot be adopted without a recorded evaluation**, because adoption is the one step
 *     that changes what listeners hear, and a step that changes what people hear has to carry its
 *     evidence with it.
 */
import { pool, jsonParse } from '../db/index.js';
import { uuid, round } from '../lib/util.js';

export type EditionStatus = 'adopted' | 'candidate' | 'rejected' | 'retired';

export interface Edition {
  id: string;
  ordinal: number;
  status: EditionStatus;
  /** The edition this one was tuned from; null means the base model. */
  baseId: string | null;
  createdAt: string;
  adoptedAt: string | null;
  retiredAt: string | null;
  datasetHash: string | null;
  datasetManifest: Record<string, unknown> | null;
  datasetPath: string | null;
  hyperparameters: Record<string, unknown>;
  adapterPath: string | null;
  feedbackWindow: Record<string, unknown> | null;
  evaluation: Record<string, unknown> | null;
  notes: string | null;
}

function mapEdition(row: Record<string, unknown>): Edition {
  return {
    id: String(row.id),
    ordinal: Number(row.ordinal),
    status: String(row.status) as EditionStatus,
    baseId: row.base_id ? String(row.base_id) : null,
    createdAt: String(row.created_at),
    adoptedAt: row.adopted_at ? String(row.adopted_at) : null,
    retiredAt: row.retired_at ? String(row.retired_at) : null,
    datasetHash: row.dataset_hash ? String(row.dataset_hash) : null,
    datasetManifest: row.dataset_manifest ? jsonParse<Record<string, unknown>>(row.dataset_manifest, {}) : null,
    datasetPath: row.dataset_path ? String(row.dataset_path) : null,
    hyperparameters: row.hyperparameters ? jsonParse<Record<string, unknown>>(row.hyperparameters, {}) : {},
    adapterPath: row.adapter_path ? String(row.adapter_path) : null,
    feedbackWindow: row.feedback_window ? jsonParse<Record<string, unknown>>(row.feedback_window, {}) : null,
    evaluation: row.evaluation ? jsonParse<Record<string, unknown>>(row.evaluation, {}) : null,
    notes: row.notes ? String(row.notes) : null,
  };
}

export function listEditions(limit = 50): Edition[] {
  const { rows } = pool.query<Record<string, unknown>>(
    'SELECT * FROM editions ORDER BY ordinal DESC LIMIT ?',
    [limit],
  );
  return rows.map(mapEdition);
}

export function getEdition(id: string): Edition | null {
  const { rows } = pool.query<Record<string, unknown>>('SELECT * FROM editions WHERE id = ?', [id]);
  return rows[0] ? mapEdition(rows[0]) : null;
}

/**
 * The edition in force, or null for the base model.
 *
 * Null is not a failure state: before the first adoption the base model is the incumbent, and the loop
 * has to be able to say so. `currentOrdinal()` turns that into the 0 a song records as its provenance.
 */
export function currentEdition(): Edition | null {
  const { rows } = pool.query<Record<string, unknown>>(
    "SELECT * FROM editions WHERE status = 'adopted' ORDER BY ordinal DESC LIMIT 1",
  );
  return rows[0] ? mapEdition(rows[0]) : null;
}

/** The ordinal a response generated now should record: 0 for the base model. */
export function currentOrdinal(): number {
  return currentEdition()?.ordinal ?? 0;
}

/**
 * Enough to tune from: the incumbent's adapter, and the ordinal the candidate will take.
 *
 * The ordinal comes from the *registry* (`MAX(ordinal) + 1`), not from the incumbent's ordinal plus one.
 * Basing it on the incumbent made a rejected candidate collide with the next one - two editions sharing an
 * ordinal - and since a song records the ordinal as its provenance, a collision makes that provenance
 * ambiguous: ordinal 2 could mean the edition that was thrown away or the one that is in force. The
 * ordinals are a saga counter; the base is only who the weights are resumed from.
 */
export function tuningBase(): { base: Edition | null; ordinal: number; resumeCheckpoint: string | null } {
  const base = currentEdition();
  const { rows } = pool.query<Record<string, unknown>>('SELECT MAX(ordinal) AS max_ordinal FROM editions');
  const highest = Number(rows[0]?.max_ordinal ?? 0);
  return {
    base,
    ordinal: (Number.isFinite(highest) ? highest : 0) + 1,
    resumeCheckpoint: base?.adapterPath ?? null,
  };
}

/**
 * Candidates that have been judged and lost since the last adoption - the loop's stop-rule input.
 *
 * `>=` rather than `>` on purpose: timestamps are second-resolution, and a candidate created in the same
 * second as the adoption it follows would otherwise not count. Under-counting a stop rule is the
 * dangerous direction - it lets a loop keep tuning past the point it should have stopped.
 */
export function noWinTrials(): number {
  const { rows } = pool.query<Record<string, unknown>>(
    "SELECT COUNT(*) AS n FROM editions WHERE status IN ('rejected', 'retired') AND adopted_at IS NULL " +
      "AND created_at >= COALESCE((SELECT MAX(adopted_at) FROM editions), '')",
  );
  return Number(rows[0]?.n ?? 0);
}

export interface CandidateInput {
  /** Null when the candidate was tuned from the base model rather than from an edition. */
  baseId: string | null;
  datasetHash: string;
  datasetManifest: Record<string, unknown>;
  datasetPath?: string;
  hyperparameters: Record<string, unknown>;
  adapterPath?: string;
  feedbackWindow?: Record<string, unknown>;
  notes?: string;
}

/**
 * Records a candidate edition.
 *
 * A candidate is *not* in force: nothing generates from it until it wins an evaluation. Registering it
 * first is what lets a training run be inspected, and thrown away, without touching what listeners hear.
 */
export function createCandidate(input: CandidateInput): Edition {
  const { ordinal } = tuningBase();
  const id = uuid();
  pool.query(
    `INSERT INTO editions
       (id, ordinal, status, base_id, dataset_hash, dataset_manifest, dataset_path, hyperparameters,
        adapter_path, feedback_window, notes)
     VALUES (?, ?, 'candidate', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      ordinal,
      input.baseId,
      input.datasetHash,
      JSON.stringify(input.datasetManifest),
      input.datasetPath ?? null,
      JSON.stringify(input.hyperparameters),
      input.adapterPath ?? null,
      input.feedbackWindow ? JSON.stringify(input.feedbackWindow) : null,
      input.notes ?? null,
    ],
  );
  return getEdition(id) as Edition;
}

/**
 * Puts an edition in force, retiring the one it replaces.
 *
 * The demotion and the promotion happen inside one transaction, because the alternative - a moment with
 * two adopted editions or none - is a moment in which the loop does not know what it is tuning from.
 */
export function adoptEdition(
  id: string,
  evaluation: Record<string, unknown>,
  options: { notes?: string } = {},
): Edition {
  const candidate = getEdition(id);
  if (!candidate) throw new Error(`no edition ${id}`);
  if (candidate.status === 'adopted') return candidate;
  if (candidate.status === 'retired') {
    throw new Error(`edition ${id} was retired and cannot be re-adopted; tune a new candidate instead`);
  }
  // The evidence travels with the decision: a row that says "adopted" and nothing else cannot be reviewed
  // later, which is the whole reason this table exists. And the decision itself has to be the authorising
  // one - adopting on an evaluation that says "reject" would be the gate being bypassed by a caller that
  // ran it, which is exactly the silent adoption this loop must not have.
  if (!evaluation || Object.keys(evaluation).length === 0) {
    throw new Error('adoption requires the evaluation it was based on');
  }
  if (evaluation.decision !== 'adopt') {
    throw new Error(
      `adoption requires an evaluation whose decision is 'adopt', got '${String(evaluation.decision)}'`,
    );
  }

  pool.query('BEGIN');
  try {
    pool.query(
      `UPDATE editions SET status = 'retired', retired_at = datetime('now')
       WHERE status = 'adopted' AND id <> ?`,
      [id],
    );
    pool.query(
      `UPDATE editions SET status = 'adopted', adopted_at = datetime('now'), evaluation = ?,
              notes = COALESCE(?, notes)
       WHERE id = ?`,
      [JSON.stringify(evaluation), options.notes ?? null, id],
    );
    pool.query('COMMIT');
  } catch (error) {
    pool.query('ROLLBACK');
    throw error;
  }
  return getEdition(id) as Edition;
}

/** Records that a candidate was judged and did not win. Kept, not deleted: a rejection is evidence too. */
export function rejectEdition(id: string, evaluation: Record<string, unknown>): Edition {
  pool.query(
    `UPDATE editions SET status = 'rejected', evaluation = ?, retired_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(evaluation), id],
  );
  return getEdition(id) as Edition;
}

/** A one-line summary per edition, for the CLI and the API. */
export function describeEdition(edition: Edition): string {
  const evaluation = edition.evaluation as { winRate?: number; pairs?: number; decision?: string } | null;
  const judged =
    evaluation && typeof evaluation.winRate === 'number'
      ? ` | win ${round(evaluation.winRate * 100, 1)}% of ${evaluation.pairs ?? '?'} pairs -> ${evaluation.decision ?? '?'}`
      : '';
  const trained = edition.datasetHash ? ` | corpus ${edition.datasetHash.slice(0, 10)}` : '';
  return `#${edition.ordinal} ${edition.status.padEnd(9)} ${edition.id.slice(0, 8)}${trained}${judged}`;
}

